import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentLink', () => {
  it('registers a no-arg tool and pushes live href/text', async () => {
    const { EmbinderProvider, AgentLink } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentLink name="go_docs" description="Open the docs" href="https://example.com/docs">Docs</AgentLink>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties).toEqual({});
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({
      name: 'go_docs',
      state: { href: 'https://example.com/docs', text: 'Docs' },
    });
  });

  it('clicks the anchor when the agent activates it', async () => {
    const { EmbinderProvider, AgentLink } = await loadSdk();
    const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(
      <EmbinderProvider>
        <AgentLink name="go_docs" description="x" href="#" onClick={onClick}>Docs</AgentLink>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'go_docs', {});
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });
});
