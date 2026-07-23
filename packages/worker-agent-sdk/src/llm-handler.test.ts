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
    // `diagnosis` is required per the schema below, but the stub omits it. The AI SDK does NOT
    // validate tool-call input against `inputSchema` itself — this stubbed call passes through
    // and becomes a normal matched submit_result entry in `result.toolCalls`, just with invalid
    // `.input` ({ wrongField: "oops" }). It's `defineLLMHandler`'s own
    // `opts.resultSchema.safeParse(submitCall.input)` check that detects the mismatch and throws.
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

    // The AI SDK's internal retry/stream-error handling swallows the raw fetch error and
    // surfaces its own "No output generated" message instead — the original error text is an
    // AI-SDK-internal implementation detail this SDK doesn't control or need to guarantee. We
    // only need to confirm the promise rejects (any error), since that's what makes worker.ts
    // call fail_task.
    await expect(handler(makeTask(), { agentId: "agent-1", taskId: "task-1" })).rejects.toThrow();
  });
});
