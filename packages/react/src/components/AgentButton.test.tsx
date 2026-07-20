// packages/react/src/components/AgentButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentButton', () => {
  it('registers a no-arg tool, anchors the element, and pushes live label/disabled state', async () => {
    const { EmbinderProvider, AgentButton } = await loadSdk();
    const { getByRole } = render(
      <EmbinderProvider>
        <AgentButton name="save" description="Save the form">Save</AgentButton>
      </EmbinderProvider>,
    );
    expect(getByRole('button').getAttribute('data-embinder-tool')).toBe('save');

    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.name).toBe('save');
    expect(reg.tool.description).toBe('Save the form');
    // no-arg tool: empty properties, no required
    expect(reg.tool.inputSchema.properties).toEqual({});
    // not context-only: it has a handler
    expect(reg.tool.annotations?.embinderContextOnly).toBeUndefined();

    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'save', state: { label: 'Save', disabled: false } });
  });

  it('clicks the real button when the agent calls the tool', async () => {
    const { EmbinderProvider, AgentButton } = await loadSdk();
    const onClick = vi.fn();
    render(
      <EmbinderProvider>
        <AgentButton name="save" description="x" onClick={onClick}>Save</AgentButton>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'save', {});
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });

  it('sets destructiveHint when destructive', async () => {
    const { EmbinderProvider, AgentButton } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentButton name="wipe" description="x" destructive>Wipe</AgentButton>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: { annotations?: Record<string, unknown> } };
    expect(reg.tool.annotations?.destructiveHint).toBe(true);
  });
});
