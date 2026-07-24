import { BlackboardApiError } from "./errors.js";
import { claimTask, completeTask, failTask, heartbeatAgent, listTasks, registerAgent } from "./rest-client.js";
import type { BlackboardConnectionConfig, Task } from "./types.js";

export interface WorkerAgentConfig extends BlackboardConnectionConfig {
  name: string;
  capabilities: string[];
  /** Required — `list_tasks`'s `blackboard_id` query param is non-optional server-side; there
   * is no "search every blackboard" mode. See the design spec's Decisions table. */
  blackboardId: string;
}

export interface HandlerContext {
  agentId: string;
  taskId: string;
}

export type TaskHandler = (task: Task, ctx: HandlerContext) => Promise<unknown>;

export interface RunOptions {
  /**
   * Required, no SDK-side default even though the server defaults to 300s if omitted — the
   * caller must explicitly decide how long their handler is allowed to run. See
   * agent-blackboard's docs/WORKER_AGENT_GUIDE.md "Known limitation: no lease renewal" and the
   * design spec's Decisions table.
   */
  leaseSeconds: number;
  /** Fixed poll cadence — no autonomous backoff in v1, see design spec. */
  pollIntervalMs: number;
  /**
   * Called when `claim_task` returns 403 (capability mismatch — a real, unexpected error per
   * docs/WORKER_AGENT_GUIDE.md). If omitted, the error is thrown and `run()` stops instead.
   */
  onError?: (error: BlackboardApiError) => void;
  /** Liveness cadence for Blackboard's agent directory. Defaults to 30 seconds. */
  heartbeatIntervalMs?: number;
}

function sleep(ms: number): { promise: Promise<void>; cancel: () => void } {
  let cancel!: () => void;
  const promise = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    cancel = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  return { promise, cancel };
}

export class WorkerAgent {
  private readonly config: WorkerAgentConfig;
  private readonly handlers = new Map<string, TaskHandler>();
  private stopped = true;
  private cancelSleep: (() => void) | null = null;

  constructor(config: WorkerAgentConfig) {
    this.config = config;
  }

  /** Registers a handler for one capability. Throws synchronously if `capability` wasn't
   * declared in `defineWorkerAgent({ capabilities })` — catches a typo at registration time
   * instead of at first poll. */
  handle(capability: string, handler: TaskHandler): void {
    if (!this.config.capabilities.includes(capability)) {
      throw new Error(
        `handle("${capability}", ...) was registered but "${capability}" is not in this worker's declared capabilities: [${this.config.capabilities.join(", ")}]`,
      );
    }
    this.handlers.set(capability, handler);
  }

  /** Halts the poll loop after the current tick. No server call — there is no "unregister
   * agent" endpoint (see SDK-ROADMAP.md's M5 Gap list). Safe to call before `run()` or multiple
   * times. */
  stop(): void {
    this.stopped = true;
    this.cancelSleep?.();
  }

  /** Registers the agent (idempotent upsert by name), then polls each capability that has a
   * registered handler until `stop()` is called. Resolves once the loop has exited cleanly. */
  async run(options: RunOptions): Promise<void> {
    const pollableCapabilities = [...this.handlers.keys()];
    if (pollableCapabilities.length === 0) {
      throw new Error(
        "WorkerAgent.run() called with no handlers registered — call .handle(capability, fn) for at least one capability first.",
      );
    }

    const agent = await registerAgent(this.config, {
      name: this.config.name,
      capabilities: this.config.capabilities,
    });
    const agentId = agent.id;
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    let nextHeartbeatAt = Date.now() + heartbeatIntervalMs;

    this.stopped = false;

    while (!this.stopped) {
      if (Date.now() >= nextHeartbeatAt) {
        await heartbeatAgent(this.config, { agentId });
        nextHeartbeatAt = Date.now() + heartbeatIntervalMs;
      }
      const claimedAndHandled = await this.pollOnce(pollableCapabilities, agentId, options);
      if (this.stopped) break;
      if (!claimedAndHandled) {
        const { promise, cancel } = sleep(options.pollIntervalMs);
        this.cancelSleep = cancel;
        await promise;
        this.cancelSleep = null;
      }
    }
  }

  /** One discovery pass across every pollable capability. Returns `true` if a task was claimed
   * and a handler ran (success or failure), so the caller can skip the poll-interval sleep and
   * immediately look for more work — matches a busy worker draining a backlog rather than
   * always waiting a full tick between tasks. */
  private async pollOnce(
    capabilities: string[],
    agentId: string,
    options: RunOptions,
  ): Promise<boolean> {
    for (const capability of capabilities) {
      if (this.stopped) return false;

      const pending = await listTasks(this.config, {
        blackboardId: this.config.blackboardId,
        capability,
        status: "pending",
      });
      const next = pending[0];
      if (!next) continue;

      const claimResult = await claimTask(this.config, {
        taskId: next.id,
        agentId,
        leaseSeconds: options.leaseSeconds,
      });

      if (!claimResult.ok) {
        if (claimResult.reason === "conflict") {
          // Normal pool-race outcome, not an error — docs/WORKER_AGENT_GUIDE.md "Pool
          // semantics". Move on to the next capability/tick.
          continue;
        }
        // "forbidden": a real, unexpected error per the Guide's "Capability mismatch" section.
        if (options.onError) {
          options.onError(claimResult.error);
          continue;
        }
        throw claimResult.error;
      }

      await this.runHandler(capability, claimResult.task, agentId);
      return true;
    }
    return false;
  }

  private async runHandler(capability: string, task: Task, agentId: string): Promise<void> {
    const handler = this.handlers.get(capability);
    if (!handler) {
      // Unreachable in practice: `capabilities` passed to pollOnce is exactly `handlers.keys()`.
      throw new Error(`no handler registered for capability "${capability}"`);
    }

    try {
      const result = await handler(task, { agentId, taskId: task.id });
      await completeTask(this.config, { taskId: task.id, agentId, result });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await failTask(this.config, { taskId: task.id, agentId, reason });
    }
  }
}

export function defineWorkerAgent(config: WorkerAgentConfig): WorkerAgent {
  return new WorkerAgent(config);
}
