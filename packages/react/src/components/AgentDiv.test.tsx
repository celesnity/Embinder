import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { setupFakeRelay, loadSdk, socket } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentDiv', () => {
  it('registers as a context-only pointer and pushes text content by default', async () => {
    const { EmbinderProvider, AgentDiv } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentDiv name="status_panel" description="Current status">Ready</AgentDiv>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: { annotations?: Record<string, unknown> } };
    expect(reg.tool.annotations?.embinderContextOnly).toBe(true);
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'status_panel', state: { text: 'Ready' } });
  });

  it('honors a custom context selector override', async () => {
    const { EmbinderProvider, AgentDiv } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentDiv name="cart" description="Cart" context={() => ({ items: 3 })}>x</AgentDiv>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'cart', state: { items: 3 } });
  });
});
