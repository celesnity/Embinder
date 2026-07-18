// "On-screen now" system block (D-5): capabilities + data-delimited bound state,
// zero synthetic tools. The block is what makes the agent's context render-scoped.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildOnScreenBlock, callableTools } from './chat.js';
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
