// useEmbinder — the pointer primitive (T1.1). Tests drive the public behavior:
// mount => register over ws + anchor prop; unmount => unregister; context() => debounced snapshots.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { StrictMode } from 'react';
import { z } from 'zod';

// ---- fake relay socket -------------------------------------------------------
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Set<(ev: unknown) => void>>();
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }
  emit(type: string, ev: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  get messages(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s));
  }
  ofType(type: string) {
    return this.messages.filter((m) => m.type === type);
  }
}

async function socket(): Promise<FakeWebSocket> {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const ws = FakeWebSocket.instances[0];
  ws.open();
  return ws;
}

// Fresh module graph per test: the provider shim is a module-scope singleton.
async function loadSdk() {
  const mod = await import('./index.js');
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ token: 'test-token' }) })),
  );
  delete (document as { modelContext?: unknown }).modelContext;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useEmbinder', () => {
  it('registers the capability on mount and anchors the element', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    function Button() {
      const bind = useEmbinder({
        name: 'add_task',
        description: 'Add a task to the board',
        input: { text: z.string().describe('Task text'), count: z.number().optional() },
        handler: ({ text }: { text: string }) => ({ ok: true, added: text }),
      });
      return <button {...bind}>Add</button>;
    }
    const { getByRole } = render(
      <EmbinderProvider>
        <Button />
      </EmbinderProvider>,
    );

    expect(getByRole('button').getAttribute('data-embinder-tool')).toBe('add_task');

    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, unknown> };
    expect(reg.tool.name).toBe('add_task');
    expect(reg.tool.description).toBe('Add a task to the board');
    const schema = reg.tool.inputSchema as {
      type: string;
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties.text.type).toBe('string');
    expect(schema.properties.text.description).toBe('Task text');
    expect(schema.properties.count.type).toBe('number');
    expect(schema.required).toEqual(['text']);
  });

  it('unregisters the capability on unmount', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    function Button() {
      const bind = useEmbinder({ name: 'add_task', description: 'x', handler: () => 'ok' });
      return <button {...bind} />;
    }
    const { unmount } = render(
      <EmbinderProvider>
        <Button />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));

    unmount();
    await waitFor(() => expect(ws.ofType('unregister').length).toBe(1));
    expect(ws.ofType('unregister')[0].name).toBe('add_task');
  });

  it('executes the real handler on an incoming call and returns the result', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    const handler = vi.fn(({ text }: { text: string }) => ({ ok: true, added: text }));
    function Button() {
      const bind = useEmbinder({
        name: 'add_task',
        description: 'x',
        input: { text: z.string() },
        handler,
      });
      return <button {...bind} />;
    }
    render(
      <EmbinderProvider>
        <Button />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));

    ws.emit('message', { data: JSON.stringify({ type: 'call', id: 'c1', name: 'add_task', args: { text: 'milk' } }) });
    await waitFor(() => expect(ws.ofType('result').length).toBe(1));
    expect(handler).toHaveBeenCalledWith({ text: 'milk' });
    expect(ws.ofType('result')[0]).toMatchObject({ id: 'c1', result: { ok: true, added: 'milk' } });
  });

  it('survives StrictMode double-mount with a single live registration and one socket', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    function Button() {
      const bind = useEmbinder({ name: 'add_task', description: 'x', handler: () => 'ok' });
      return <button {...bind} />;
    }
    render(
      <StrictMode>
        <EmbinderProvider>
          <Button />
        </EmbinderProvider>
      </StrictMode>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBeGreaterThan(0));
    expect(FakeWebSocket.instances.length).toBe(1);
    // net registrations after the mount/unmount/mount dance must be exactly one
    await waitFor(() =>
      expect(ws.ofType('register').length - ws.ofType('unregister').length).toBe(1),
    );
  });

  it('pushes a debounced context snapshot when bound state changes, nothing when unchanged', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    const { useState } = await import('react');
    let bumpTasks: () => void;
    let bumpUnrelated: () => void;
    function Board() {
      const [tasks, setTasks] = useState<string[]>(['milk']);
      const [, setUnrelated] = useState(0);
      bumpTasks = () => setTasks((t) => [...t, 'eggs']);
      bumpUnrelated = () => setUnrelated((n) => n + 1);
      const bind = useEmbinder({
        name: 'task_board',
        description: 'The task board',
        context: () => ({ tasks }),
      });
      return <div {...bind} />;
    }
    const { act } = await import('@testing-library/react');
    render(
      <EmbinderProvider>
        <Board />
      </EmbinderProvider>,
    );
    const ws = await socket();

    // initial snapshot arrives (debounced)
    await waitFor(() => expect(ws.ofType('context').length).toBe(1));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'task_board', state: { tasks: ['milk'] } });

    // unrelated re-render: no new snapshot
    act(() => bumpUnrelated!());
    await new Promise((r) => setTimeout(r, 250));
    expect(ws.ofType('context').length).toBe(1);

    // real change: one more snapshot
    act(() => bumpTasks!());
    await waitFor(() => expect(ws.ofType('context').length).toBe(2));
    expect(ws.ofType('context')[1]).toMatchObject({ name: 'task_board', state: { tasks: ['milk', 'eggs'] } });
  });

  it('marks a pointer without a handler as context-only in the register message', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    function Board() {
      const bind = useEmbinder({ name: 'task_board', description: 'The board', context: () => ({}) });
      return <div {...bind} />;
    }
    render(
      <EmbinderProvider>
        <Board />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: { annotations?: Record<string, unknown> } };
    expect(reg.tool.annotations?.embinderContextOnly).toBe(true);
  });

  it('truncates oversized context snapshots with a marker and a warning', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = 'x'.repeat(20 * 1024);
    function Board() {
      const bind = useEmbinder({ name: 'big_board', description: 'x', context: () => ({ big }) });
      return <div {...bind} />;
    }
    render(
      <EmbinderProvider>
        <Board />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('context').length).toBe(1));
    expect(ws.ofType('context')[0].state).toBe('[truncated]');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('truncated'));
  });

  it('always invokes the latest handler closure, not the mount-time one', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    const { useState } = await import('react');
    const { act } = await import('@testing-library/react');
    let bump: () => void;
    function Counter() {
      const [count, setCount] = useState(0);
      bump = () => setCount((c) => c + 1);
      const bind = useEmbinder({
        name: 'read_count',
        description: 'x',
        handler: () => ({ count }), // closes over state directly — must not go stale
      });
      return <div {...bind} />;
    }
    render(
      <EmbinderProvider>
        <Counter />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));

    act(() => bump!());
    ws.emit('message', { data: JSON.stringify({ type: 'call', id: 'c1', name: 'read_count', args: {} }) });
    await waitFor(() => expect(ws.ofType('result').length).toBe(1));
    expect(ws.ofType('result')[0].result).toEqual({ count: 1 });
  });

  it('reconnects and re-registers mounted tools after relay socket closes', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    function Button() {
      const bind = useEmbinder({ name: 'add_task', description: 'x', handler: () => 'ok' });
      return <button {...bind} />;
    }
    render(<EmbinderProvider chat={false}><Button /></EmbinderProvider>);
    const first = await socket();
    await waitFor(() => expect(first.ofType('register')).toHaveLength(1));
    first.emit('close', {});
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    const second = FakeWebSocket.instances[1];
    second.open();
    await waitFor(() => expect(second.ofType('register')).toHaveLength(1));
    expect((second.ofType('register')[0] as { tool: { name: string } }).tool.name).toBe('add_task');
  });

  it('mounts the chat bubble by default and honors the opt-out (D-9)', async () => {
    vi.doMock('./chat/ChatBubble.js', () => ({
      ChatBubble: () => <div data-testid="bubble" />,
    }));
    const { EmbinderProvider } = await import('./index.js');
    const { findByTestId, queryByTestId, unmount } = render(
      <EmbinderProvider>
        <span>app</span>
      </EmbinderProvider>,
    );
    expect(await findByTestId('bubble')).toBeTruthy();
    unmount();

    const optOut = render(
      <EmbinderProvider chat={false}>
        <span>app</span>
      </EmbinderProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(optOut.queryByTestId('bubble')).toBeNull();
    vi.doUnmock('./chat/ChatBubble.js');
  });

  it('errors in dev when two mounted pointers share a name', async () => {
    const { EmbinderProvider, useEmbinder } = await loadSdk();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Button({ label }: { label: string }) {
      const bind = useEmbinder({ name: 'add_task', description: 'x', handler: () => 'ok' });
      return <button {...bind}>{label}</button>;
    }
    render(
      <EmbinderProvider>
        <Button label="a" />
        <Button label="b" />
      </EmbinderProvider>,
    );
    await socket();
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.stringContaining('duplicate embinder pointer name "add_task"')),
    );
  });
});
