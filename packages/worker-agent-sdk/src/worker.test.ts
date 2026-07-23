import { afterEach, describe, expect, it, vi } from "vitest";
import { BlackboardApiError, defineWorkerAgent } from "./index.js";
import type { Task } from "./types.js";

/**
 * Isolates WorkerAgent's poll/claim/handle/report logic from real network I/O by substituting
 * `globalThis.fetch` (same tier as this repo's existing `packages/relay/src/*.test.ts` unit
 * suites). This is NOT the "real, no-mock" claim — that's worker.integration.test.ts, gated on
 * a real running blackboard-server.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    tenant_id: "tenant-1",
    blackboard_id: "board-1",
    capability: "diagnostics",
    status: "pending",
    subject: "pump-3",
    input: { reading: 42 },
    result: null,
    failure_reason: null,
    assigned_agent_id: null,
    attempt_count: 0,
    claimed_at: null,
    lease_expires_at: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

interface FetchCall {
  method: string;
  path: string;
  body: unknown;
}

/** Records every call and dispatches based on a small routing table the test supplies. */
function fakeFetch(
  route: (call: FetchCall) => Response | undefined,
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input : input.toString());
    const call: FetchCall = {
      method: init?.method ?? "GET",
      path: url.pathname + url.search,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const response = route(call);
    if (!response) {
      throw new Error(`unhandled fake fetch call: ${call.method} ${call.path}`);
    }
    return response;
  }) as typeof fetch;
  return { fetch: fn, calls };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const config = {
  name: "diagnostics-worker-1",
  capabilities: ["diagnostics"],
  baseUrl: "http://fake.local",
  apiKey: "test-key",
  blackboardId: "board-1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkerAgent", () => {
  it("registers once and completes a claimed task with the handler's return value", async () => {
    const task = makeTask();
    let listCalls = 0;
    const { fetch: fake, calls } = fakeFetch((call) => {
      if (call.method === "POST" && call.path === "/api/v1/agents") {
        return jsonResponse(200, { id: "agent-1", tenant_id: "t", name: config.name, labels: [], capabilities: config.capabilities });
      }
      if (call.method === "GET" && call.path.startsWith("/api/v1/tasks?")) {
        listCalls += 1;
        return jsonResponse(200, listCalls === 1 ? [task] : []);
      }
      if (call.method === "POST" && call.path === "/api/v1/tasks/task-1/claim") {
        return jsonResponse(200, { ...task, status: "claimed", assigned_agent_id: "agent-1" });
      }
      if (call.method === "POST" && call.path === "/api/v1/tasks/task-1/complete") {
        return jsonResponse(200, { ...task, status: "completed", result: call.body });
      }
      return undefined;
    });
    vi.stubGlobal("fetch", fake);

    const worker = defineWorkerAgent(config);
    worker.handle("diagnostics", async () => ({ diagnosis: "worn bearing" }));

    const running = worker.run({ leaseSeconds: 300, pollIntervalMs: 5 });
    await waitFor(() => calls.some((c) => c.path === "/api/v1/tasks/task-1/complete"));
    worker.stop();
    await running;

    expect(calls.filter((c) => c.method === "POST" && c.path === "/api/v1/agents")).toHaveLength(1);
    const complete = calls.find((c) => c.path === "/api/v1/tasks/task-1/complete");
    expect(complete?.body).toMatchObject({ agent_id: "agent-1", result: { diagnosis: "worn bearing" } });
  });

  it("fails the task with the thrown error's message when the handler throws", async () => {
    const task = makeTask();
    let listCalls = 0;
    const { fetch: fake, calls } = fakeFetch((call) => {
      if (call.method === "POST" && call.path === "/api/v1/agents") {
        return jsonResponse(200, { id: "agent-1", tenant_id: "t", name: config.name, labels: [], capabilities: config.capabilities });
      }
      if (call.method === "GET" && call.path.startsWith("/api/v1/tasks?")) {
        listCalls += 1;
        return jsonResponse(200, listCalls === 1 ? [task] : []);
      }
      if (call.method === "POST" && call.path === "/api/v1/tasks/task-1/claim") {
        return jsonResponse(200, { ...task, status: "claimed", assigned_agent_id: "agent-1" });
      }
      if (call.method === "POST" && call.path === "/api/v1/tasks/task-1/fail") {
        return jsonResponse(200, { ...task, status: "failed", failure_reason: call.body && (call.body as { reason: string }).reason });
      }
      return undefined;
    });
    vi.stubGlobal("fetch", fake);

    const worker = defineWorkerAgent(config);
    worker.handle("diagnostics", async () => {
      throw new Error("sensor timeout");
    });

    const running = worker.run({ leaseSeconds: 300, pollIntervalMs: 5 });
    await waitFor(() => calls.some((c) => c.path === "/api/v1/tasks/task-1/fail"));
    worker.stop();
    await running;

    const fail = calls.find((c) => c.path === "/api/v1/tasks/task-1/fail");
    expect(fail?.body).toMatchObject({ agent_id: "agent-1", reason: "sensor timeout" });
  });

  it("treats 409 on claim as routine and keeps polling without throwing", async () => {
    const task = makeTask();
    let claimAttempts = 0;
    const { fetch: fake } = fakeFetch((call) => {
      if (call.method === "POST" && call.path === "/api/v1/agents") {
        return jsonResponse(200, { id: "agent-1", tenant_id: "t", name: config.name, labels: [], capabilities: config.capabilities });
      }
      if (call.method === "GET" && call.path.startsWith("/api/v1/tasks?")) {
        return jsonResponse(200, [task]);
      }
      if (call.method === "POST" && call.path === "/api/v1/tasks/task-1/claim") {
        claimAttempts += 1;
        return jsonResponse(409, { error: "task task-1 is already claimed" });
      }
      return undefined;
    });
    vi.stubGlobal("fetch", fake);

    const worker = defineWorkerAgent(config);
    worker.handle("diagnostics", async () => "unreachable");

    const onError = vi.fn();
    const running = worker.run({ leaseSeconds: 300, pollIntervalMs: 5, onError });
    await waitFor(() => claimAttempts >= 2);
    worker.stop();
    await expect(running).resolves.toBeUndefined();

    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError and keeps running on 403 (capability mismatch) when onError is provided", async () => {
    const task = makeTask();
    const { fetch: fake } = fakeFetch((call) => {
      if (call.method === "POST" && call.path === "/api/v1/agents") {
        return jsonResponse(200, { id: "agent-1", tenant_id: "t", name: config.name, labels: [], capabilities: config.capabilities });
      }
      if (call.method === "GET" && call.path.startsWith("/api/v1/tasks?")) {
        return jsonResponse(200, [task]);
      }
      if (call.method === "POST" && call.path === "/api/v1/tasks/task-1/claim") {
        return jsonResponse(403, { error: "agent agent-1 does not have capability 'diagnostics'" });
      }
      return undefined;
    });
    vi.stubGlobal("fetch", fake);

    const worker = defineWorkerAgent(config);
    worker.handle("diagnostics", async () => "unreachable");

    const onError = vi.fn();
    const running = worker.run({ leaseSeconds: 300, pollIntervalMs: 5, onError });
    await waitFor(() => onError.mock.calls.length >= 1);
    worker.stop();
    await expect(running).resolves.toBeUndefined();

    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(BlackboardApiError);
    expect((onError.mock.calls[0]?.[0] as BlackboardApiError).status).toBe(403);
  });

  it("throws and stops the loop on 403 when no onError is provided", async () => {
    const task = makeTask();
    const { fetch: fake } = fakeFetch((call) => {
      if (call.method === "POST" && call.path === "/api/v1/agents") {
        return jsonResponse(200, { id: "agent-1", tenant_id: "t", name: config.name, labels: [], capabilities: config.capabilities });
      }
      if (call.method === "GET" && call.path.startsWith("/api/v1/tasks?")) {
        return jsonResponse(200, [task]);
      }
      if (call.method === "POST" && call.path === "/api/v1/tasks/task-1/claim") {
        return jsonResponse(403, { error: "agent agent-1 does not have capability 'diagnostics'" });
      }
      return undefined;
    });
    vi.stubGlobal("fetch", fake);

    const worker = defineWorkerAgent(config);
    worker.handle("diagnostics", async () => "unreachable");

    await expect(worker.run({ leaseSeconds: 300, pollIntervalMs: 5 })).rejects.toBeInstanceOf(
      BlackboardApiError,
    );
  });

  it("resolves run()'s promise once stop() is called, even with no work available", async () => {
    const { fetch: fake } = fakeFetch((call) => {
      if (call.method === "POST" && call.path === "/api/v1/agents") {
        return jsonResponse(200, { id: "agent-1", tenant_id: "t", name: config.name, labels: [], capabilities: config.capabilities });
      }
      if (call.method === "GET" && call.path.startsWith("/api/v1/tasks?")) {
        return jsonResponse(200, []);
      }
      return undefined;
    });
    vi.stubGlobal("fetch", fake);

    const worker = defineWorkerAgent(config);
    worker.handle("diagnostics", async () => "unreachable");

    const running = worker.run({ leaseSeconds: 300, pollIntervalMs: 50 });
    // Give it one tick to enter the sleep, then stop — this proves stop() cancels the sleep
    // immediately rather than waiting out the full pollIntervalMs.
    await new Promise((r) => setTimeout(r, 5));
    const before = Date.now();
    worker.stop();
    await running;
    expect(Date.now() - before).toBeLessThan(50);
  });

  it("rejects handle() for a capability not in the declared capabilities list", () => {
    const worker = defineWorkerAgent(config);
    expect(() => worker.handle("unrelated-capability", async () => undefined)).toThrow();
  });

  it("rejects run() with no handlers registered", async () => {
    const worker = defineWorkerAgent(config);
    await expect(worker.run({ leaseSeconds: 300, pollIntervalMs: 5 })).rejects.toThrow(
      /no handlers registered/,
    );
  });
});
