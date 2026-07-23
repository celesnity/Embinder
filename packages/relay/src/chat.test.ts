// "On-screen now" system block (D-5): capabilities + data-delimited bound state,
// zero synthetic tools. The block is what makes the agent's context render-scoped.
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { tool } from 'ai';
import { buildOnScreenBlock, callableTools, executeFocus } from './chat.js';
import type { CapabilityDef } from './registry.js';

const entries = (): Array<[string, CapabilityDef]> => [
  [
    'add_task',
    { config: { description: 'Add a new task', inputSchema: { text: z.string() } }, destructive: false },
  ],
  [
    'task_board',
    {
      config: { description: 'The task board', annotations: { embinderContextOnly: true } },
      destructive: false,
      contextState: { tasks: [{ id: 't1', text: 'milk', done: false }] },
      contextTs: 1,
    },
  ],
];

describe('buildOnScreenBlock', () => {
  it('lists capabilities with schema summaries and data-delimited bound state', () => {
    const block = buildOnScreenBlock(entries());
    expect(block).toContain('On-screen now');
    expect(block).toContain('add_task(text)');
    expect(block).toContain('Add a new task');
    expect(block).toContain('task_board');
    expect(block).toContain('<embinder:data>');
    expect(block).toContain('"text":"milk"');
    expect(block).toContain('</embinder:data>');
    // injection guard: state is labeled display data, not instructions
    expect(block).toMatch(/display data[^]*not instructions/i);
  });

  it('omits the data block for capabilities without bound state', () => {
    const block = buildOnScreenBlock(entries());
    const addTaskLine = block.split('\n').find((l) => l.includes('add_task'))!;
    expect(addTaskLine).not.toContain('<embinder:data>');
  });
});

describe('callableTools', () => {
  it('excludes context-only pointers from the tool set', () => {
    const names = callableTools(entries()).map(([name]) => name);
    expect(names).toEqual(['add_task']);
  });
});

describe('executeFocus', () => {
  it('emits a UI focus phase after chat activates a scope', () => {
    const onFocus = vi.fn();
    const result = executeFocus(
      { entries: () => [], focus: () => ({ ok: true, state: { id: 't1' } }) },
      'chat:1',
      'focus_task_t1',
      onFocus,
    );
    expect(result).toEqual({ id: 't1' });
    expect(onFocus).toHaveBeenCalledWith({ name: 'focus_task_t1', scopeId: 'task_t1' });
  });
});

describe('operator-configured LLM endpoint', () => {
  it('auto-allowlists the host of env LLM_BASE_URL', async () => {
    const { baseURLAllowed } = await import('./chat.js');
    const prev = process.env.LLM_BASE_URL;
    process.env.LLM_BASE_URL = 'https://api.openai.com';
    expect(baseURLAllowed('https://api.openai.com/v1')).toBe(true);
    expect(baseURLAllowed('https://evil.example.com/v1')).toBe(false);
    delete process.env.LLM_BASE_URL;
    expect(baseURLAllowed('https://api.openai.com/v1')).toBe(false);
    if (prev !== undefined) process.env.LLM_BASE_URL = prev;
  });

  it('normalizes a bare origin to its /v1 API root, leaving explicit paths alone', async () => {
    const { normalizeBaseURL } = await import('./chat.js');
    expect(normalizeBaseURL('https://api.openai.com')).toBe('https://api.openai.com/v1');
    expect(normalizeBaseURL('https://api.openai.com/')).toBe('https://api.openai.com/v1');
    expect(normalizeBaseURL('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
    expect(normalizeBaseURL(undefined)).toBeUndefined();
  });
});

// Minimal OpenAI-compatible /chat/completions SSE stub, adapted from scripts/e2e.mjs's
// startStubLLM but as an injected `fetch` (hermetic, no real server) instead of a real
// http.createServer. Turn 1 (no tool role in messages yet): emit a tool call if `toolName`
// is set, else a final text chunk. Turn 2+ (messages contain a tool role): always final text.
function fakeOpenAICompatibleFetch(
  toolName: string | null,
  toolArgs: unknown,
  seenHeaders: Record<string, string>[] = [],
): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const payload = init?.body ? JSON.parse(init.body as string) : {};
    seenHeaders.push(Object.fromEntries(new Headers(init?.headers).entries()));
    const hasToolResult = (payload.messages ?? []).some((m: { role: string }) => m.role === 'tool');
    const id = 'chatcmpl-stub';
    const created = 1700000000;
    const send = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    let sse = '';
    if (!hasToolResult && toolName) {
      sse += send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: toolName, arguments: '' } }] }, finish_reason: null }] });
      sse += send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(toolArgs) } }] }, finish_reason: null }] });
      sse += send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      sse += send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] });
      sse += send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    sse += 'data: [DONE]\n\n';
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
}

describe('runAgentLoop', () => {
  it('runs a tool the model calls, then resolves the final text', async () => {
    const { runAgentLoop } = await import('./chat.js');
    const echo = tool({
      description: 'Echo text back',
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }: { text: string }) => ({ echoed: text }),
    });

    const result = runAgentLoop({
      baseURL: 'http://fake.local/v1',
      model: 'stub-model',
      system: 'test',
      messages: [{ role: 'user', content: 'say hi' }],
      tools: { echo },
      fetch: fakeOpenAICompatibleFetch('echo', { text: 'hi' }),
    });

    const toolCalls = await result.toolCalls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ toolName: 'echo', input: { text: 'hi' } });
    expect(await result.text).toBe('done');
  });

  it('defaults apiKey to "not-needed" when unset', async () => {
    const { runAgentLoop } = await import('./chat.js');
    const seenHeaders: Record<string, string>[] = [];
    const result = runAgentLoop({
      baseURL: 'http://fake.local/v1',
      model: 'stub-model',
      system: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
      fetch: fakeOpenAICompatibleFetch(null, undefined, seenHeaders),
    });
    expect(await result.text).toBe('done');
    expect(seenHeaders[0]?.authorization).toBe('Bearer not-needed');
  });
});

describe('GET /chat-config (D-9)', () => {
  it('serves LLM config from env, empty when unset', async () => {
    const { default: express } = await import('express');
    const { mountChatConfigRoute } = await import('./chat.js');
    const listen = (a: ReturnType<typeof express>) =>
      new Promise<{ close(): void; port: number }>((resolve) => {
        const s = a.listen(0, '127.0.0.1', () =>
          resolve({ close: () => s.close(), port: (s.address() as { port: number }).port }),
        );
      });

    const app = express();
    mountChatConfigRoute(app, { baseURL: 'http://127.0.0.1:1234/v1', model: 'qwen' });
    const server = await listen(app);
    const cfg = await (await fetch(`http://127.0.0.1:${server.port}/chat-config`)).json();
    expect(cfg).toEqual({ baseURL: 'http://127.0.0.1:1234/v1', model: 'qwen' });

    const bare = express();
    mountChatConfigRoute(bare, {});
    const server2 = await listen(bare);
    const empty = await (await fetch(`http://127.0.0.1:${server2.port}/chat-config`)).json();
    expect(empty).toEqual({ baseURL: null, model: null });
    server.close();
    server2.close();
  });
});
