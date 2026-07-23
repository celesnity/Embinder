import { BlackboardApiError } from "./errors.js";
import type { AgentIdentity, BlackboardConnectionConfig, Task, TaskStatus } from "./types.js";

/**
 * Internal-only REST calls for the Worker Agent lifecycle — not exported from index.ts. This is
 * deliberately NOT a general-purpose Blackboard client (no projects/blackboards/artifacts/
 * subscriptions resources); see the design spec's Non-goals section for why that's out of
 * scope here. Endpoints match agent-blackboard's README.md API reference table and
 * apps/blackboard-server/src/routes/{agents,tasks}.rs exactly.
 */

async function request(
  cfg: BlackboardConnectionConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(new URL(path, cfg.baseUrl), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      ...init?.headers,
    },
  });
  return response;
}

async function requestJson<T>(
  cfg: BlackboardConnectionConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await request(cfg, path, init);
  if (!response.ok) {
    throw await BlackboardApiError.fromResponse(response);
  }
  return (await response.json()) as T;
}

export async function registerAgent(
  cfg: BlackboardConnectionConfig,
  args: { name: string; capabilities: string[]; labels?: string[] },
): Promise<AgentIdentity> {
  return requestJson<AgentIdentity>(cfg, "/api/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      name: args.name,
      capabilities: args.capabilities,
      labels: args.labels ?? [],
    }),
  });
}

export async function listTasks(
  cfg: BlackboardConnectionConfig,
  args: { blackboardId: string; capability?: string; status?: TaskStatus },
): Promise<Task[]> {
  const params = new URLSearchParams({ blackboard_id: args.blackboardId });
  if (args.capability) params.set("capability", args.capability);
  if (args.status) params.set("status", args.status);
  return requestJson<Task[]>(cfg, `/api/v1/tasks?${params.toString()}`, { method: "GET" });
}

/**
 * `409` (already claimed, live lease) and `403` (capability mismatch) are both routine,
 * expected outcomes of a pool race per agent-blackboard's docs/WORKER_AGENT_GUIDE.md — reported
 * through the return value rather than thrown, so the poll loop isn't forced into a try/catch
 * just to tell them apart from a real transport failure (which still throws BlackboardApiError
 * normally).
 */
export type ClaimResult =
  | { ok: true; task: Task }
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "forbidden"; error: BlackboardApiError };

export async function claimTask(
  cfg: BlackboardConnectionConfig,
  args: { taskId: string; agentId: string; leaseSeconds: number },
): Promise<ClaimResult> {
  const response = await request(cfg, `/api/v1/tasks/${args.taskId}/claim`, {
    method: "POST",
    body: JSON.stringify({ agent_id: args.agentId, lease_seconds: args.leaseSeconds }),
  });
  if (response.status === 409) return { ok: false, reason: "conflict" };
  if (response.status === 403) {
    return { ok: false, reason: "forbidden", error: await BlackboardApiError.fromResponse(response) };
  }
  if (!response.ok) throw await BlackboardApiError.fromResponse(response);
  return { ok: true, task: (await response.json()) as Task };
}

export async function completeTask(
  cfg: BlackboardConnectionConfig,
  args: { taskId: string; agentId: string; result: unknown },
): Promise<Task> {
  return requestJson<Task>(cfg, `/api/v1/tasks/${args.taskId}/complete`, {
    method: "POST",
    body: JSON.stringify({ agent_id: args.agentId, result: args.result }),
  });
}

export async function failTask(
  cfg: BlackboardConnectionConfig,
  args: { taskId: string; agentId: string; reason: string },
): Promise<Task> {
  return requestJson<Task>(cfg, `/api/v1/tasks/${args.taskId}/fail`, {
    method: "POST",
    body: JSON.stringify({ agent_id: args.agentId, reason: args.reason }),
  });
}
