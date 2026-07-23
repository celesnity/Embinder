import { beforeAll, describe, expect, it } from "vitest";
import { defineWorkerAgent } from "./index.js";

/**
 * Real HTTP against an already-running agent-blackboard `blackboard-server` — no mocking, same
 * tier as that repo's `test_support::test_app()` integration tests and its
 * `e2e/mcp-client/client.py`'s `run_worker()`. Gated on REST_URL/API_KEY exactly like that
 * script's `_require_env`, so this suite is skipped (not silently passed) without a live
 * server. Not part of `npm run test` — run explicitly via `npm run test:integration` in this
 * package.
 *
 * Start a server first (in the sibling agent-blackboard repo), e.g.:
 *   cargo run -p blackboard-server                     (in-memory, logs `dev-key` on boot)
 *   REST_URL=http://localhost:8080 API_KEY=dev-key npm run test:integration
 */

const REST_URL = process.env.REST_URL;
const API_KEY = process.env.API_KEY;
const hasLiveServer = Boolean(REST_URL && API_KEY);

async function postJson(path: string, apiKey: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(path, REST_URL), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed with status ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

describe.skipIf(!hasLiveServer)("WorkerAgent — real blackboard-server", () => {
  let blackboardId: string;

  beforeAll(async () => {
    if (!hasLiveServer) return;
    const project = await postJson("/api/v1/projects", API_KEY!, { name: `sdk-it-${Date.now()}` });
    const blackboard = await postJson("/api/v1/blackboards", API_KEY!, {
      project_id: project.id,
      name: `sdk-it-${Date.now()}`,
    });
    blackboardId = blackboard.id as string;
  });

  it("claims and completes a real Task created via REST, matching run_worker()'s behavior", async () => {
    const task = await postJson("/api/v1/tasks", API_KEY!, {
      blackboard_id: blackboardId,
      capability: "sdk-it-diagnostics",
      subject: "pump-3",
      input: { reading: 42 },
    });

    const worker = defineWorkerAgent({
      name: `sdk-it-worker-${Date.now()}`,
      capabilities: ["sdk-it-diagnostics"],
      baseUrl: REST_URL!,
      apiKey: API_KEY!,
      blackboardId,
    });
    worker.handle("sdk-it-diagnostics", async (claimed) => {
      expect(claimed.id).toBe(task.id);
      return { diagnosis: "worn bearing" };
    });

    const running = worker.run({ leaseSeconds: 60, pollIntervalMs: 200 });
    const deadline = Date.now() + 10_000;
    let finalStatus: string | undefined;
    while (Date.now() < deadline) {
      const response = await fetch(new URL(`/api/v1/tasks/${task.id}`, REST_URL), {
        headers: { "x-api-key": API_KEY! },
      });
      const body = (await response.json()) as { status: string; result: unknown };
      if (body.status === "completed") {
        finalStatus = body.status;
        expect(body.result).toEqual({ diagnosis: "worn bearing" });
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    worker.stop();
    await running;

    expect(finalStatus).toBe("completed");
  });
});
