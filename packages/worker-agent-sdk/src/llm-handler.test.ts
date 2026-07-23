import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tool } from "ai";
import { defineLLMHandler } from "./llm-handler.js";
import type { Task } from "./types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    tenant_id: "tenant-1",
    blackboard_id: "board-1",
    capability: "diagnostics",
    status: "claimed",
    subject: "pump-3",
    input: { reading: 42 },
    result: null,
    failure_reason: null,
    assigned_agent_id: "agent-1",
    attempt_count: 0,
    claimed_at: new Date().toISOString(),
    lease_expires_at: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

// Same stub shape as packages/relay/src/chat.test.ts's fakeOpenAICompatibleFetch — kept
// duplicated here (test-only, ~20 lines) rather than shared, since it's the only thing
// worker-agent-sdk's test suite would need from relay's test file.
function fakeOpenAICompatibleFetch(toolName: string, toolArgs: unknown): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const payload = init?.body ? JSON.parse(init.body as string) : {};
    const hasToolResult = (payload.messages ?? []).some((m: { role: string }) => m.role === "tool");
    const id = "chatcmpl-stub";
    const created = 1700000000;
    const send = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    let sse = "";
    if (!hasToolResult) {
      sse += send({ id, object: "chat.completion.chunk", created, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: toolName, arguments: "" } }] }, finish_reason: null }] });
      sse += send({ id, object: "chat.completion.chunk", created, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(toolArgs) } }] }, finish_reason: null }] });
      sse += send({ id, object: "chat.completion.chunk", created, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    } else {
      sse += send({ id, object: "chat.completion.chunk", created, choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] });
      sse += send({ id, object: "chat.completion.chunk", created, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    }
    sse += "data: [DONE]\n\n";
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
});

describe("defineLLMHandler", () => {
  it("resolves with submit_result's schema-validated args when the LLM calls it", async () => {
    process.env.LLM_BASE_URL = "http://fake.local/v1";
    process.env.LLM_MODEL = "stub-model";
    vi.stubGlobal("fetch", fakeOpenAICompatibleFetch("submit_result", { diagnosis: "worn bearing" }));

    const handler = defineLLMHandler({
      tools: {},
      system: "You are a diagnostics agent.",
      resultSchema: z.object({ diagnosis: z.string() }),
    });

    const result = await handler(makeTask(), { agentId: "agent-1", taskId: "task-1" });
    expect(result).toEqual({ diagnosis: "worn bearing" });
  });

  it("passes the claimed task's capability-specific tools to the loop", async () => {
    process.env.LLM_BASE_URL = "http://fake.local/v1";
    process.env.LLM_MODEL = "stub-model";
    const runCheck = tool({
      description: "Run a check",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fakeOpenAICompatibleFetch("submit_result", { diagnosis: "fine" }));

    const handler = defineLLMHandler({
      tools: { runCheck },
      system: (task: Task) => `Diagnose ${task.subject}.`,
      resultSchema: z.object({ diagnosis: z.string() }),
    });

    await expect(handler(makeTask(), { agentId: "agent-1", taskId: "task-1" })).resolves.toEqual({
      diagnosis: "fine",
    });
  });

  it("throws when the LLM never calls submit_result", async () => {
    process.env.LLM_BASE_URL = "http://fake.local/v1";
    process.env.LLM_MODEL = "stub-model";
    // Fake always responds with plain text, never the tool call submit_result needs.
    vi.stubGlobal("fetch", (async () => {
      const sse = `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, choices: [{ index: 0, delta: { role: "assistant", content: "I am not sure." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch);

    const handler = defineLLMHandler({
      tools: {},
      system: "test",
      resultSchema: z.object({ diagnosis: z.string() }),
    });

    await expect(handler(makeTask(), { agentId: "agent-1", taskId: "task-1" })).rejects.toThrow(
      /submit_result/,
    );
  });

  it("throws before any fetch call when LLM_BASE_URL/LLM_MODEL are unset", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const handler = defineLLMHandler({
      tools: {},
      system: "test",
      resultSchema: z.object({ diagnosis: z.string() }),
    });

    await expect(handler(makeTask(), { agentId: "agent-1", taskId: "task-1" })).rejects.toThrow(
      /LLM_BASE_URL/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when the LLM calls submit_result with input that fails resultSchema", async () => {
    process.env.LLM_BASE_URL = "http://fake.local/v1";
    process.env.LLM_MODEL = "stub-model";
    // `diagnosis` is required per the schema below; the stub omits it, so the AI SDK's own
    // tool-input validation rejects this call — it never becomes a matched submit_result call,
    // so this exercises the same "no valid submit_result" failure path as the test above, just
    // via a schema mismatch instead of the LLM never calling the tool at all.
    vi.stubGlobal("fetch", fakeOpenAICompatibleFetch("submit_result", { wrongField: "oops" }));

    const handler = defineLLMHandler({
      tools: {},
      system: "test",
      resultSchema: z.object({ diagnosis: z.string() }),
    });

    await expect(handler(makeTask(), { agentId: "agent-1", taskId: "task-1" })).rejects.toThrow();
  });

  it("propagates an upstream fetch failure", async () => {
    process.env.LLM_BASE_URL = "http://fake.local/v1";
    process.env.LLM_MODEL = "stub-model";
    vi.stubGlobal(
      "fetch",
      (async () => {
        throw new Error("network unreachable");
      }) as typeof fetch,
    );

    const handler = defineLLMHandler({
      tools: {},
      system: "test",
      resultSchema: z.object({ diagnosis: z.string() }),
    });

    await expect(handler(makeTask(), { agentId: "agent-1", taskId: "task-1" })).rejects.toThrow(
      /network unreachable/,
    );
  });
});
