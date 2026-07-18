// packages/react/src/components/agent-test-harness.tsx
// Shared fake relay socket + setup for agent-component tests. Mirrors the harness
// inlined in ../use-embinder.test.tsx so each component test stays small.
import { beforeEach, afterEach, expect, vi } from 'vitest';
import { waitFor, cleanup } from '@testing-library/react';

export class FakeWebSocket {
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

export function setupFakeRelay(): void {
  beforeEach(() => {
    vi.resetModules();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ token: 'test-token' }) })));
    delete (document as { modelContext?: unknown }).modelContext;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
}

export async function loadSdk() {
  return await import('../index.js');
}

export async function socket(): Promise<FakeWebSocket> {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const ws = FakeWebSocket.instances[0];
  ws.open();
  return ws;
}

export function callTool(ws: FakeWebSocket, name: string, args: unknown = {}): void {
  ws.emit('message', { data: JSON.stringify({ type: 'call', id: 'c1', name, args }) });
}
