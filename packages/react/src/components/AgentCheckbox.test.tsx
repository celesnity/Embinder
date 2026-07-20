import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentCheckbox', () => {
  it('registers a { checked } tool and pushes live checked/disabled', async () => {
    const { EmbinderProvider, AgentCheckbox } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentCheckbox name="done" description="Mark task done" defaultChecked={false} />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties.checked.type).toBe('boolean');
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'done', state: { checked: false, disabled: false } });
  });

  it('toggles to the requested checked state and fires onChange', async () => {
    const { EmbinderProvider, AgentCheckbox } = await loadSdk();
    const seen: boolean[] = [];
    function Controlled() {
      const [c, setC] = useState(false);
      return (
        <AgentCheckbox
          name="done"
          description="x"
          checked={c}
          onChange={(e) => {
            seen.push(e.target.checked);
            setC(e.target.checked);
          }}
        />
      );
    }
    render(
      <EmbinderProvider>
        <Controlled />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'done', { checked: true });
    await waitFor(() => expect(seen).toContain(true));
  });
});
