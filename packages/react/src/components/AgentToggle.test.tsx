// packages/react/src/components/AgentToggle.test.tsx
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentToggle', () => {
  it('registers an { on } tool and pushes live on/disabled from aria-checked', async () => {
    const { EmbinderProvider, AgentToggle } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentToggle name="notify" description="Notifications" aria-checked={false}>Off</AgentToggle>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties.on.type).toBe('boolean');
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'notify', state: { on: false, disabled: false } });
  });

  it('clicks to reach the requested on state, and no-ops when already there', async () => {
    const { EmbinderProvider, AgentToggle } = await loadSdk();
    let clicks = 0;
    function Controlled() {
      const [on, setOn] = useState(false);
      return (
        <AgentToggle
          name="notify"
          description="x"
          aria-checked={on}
          onClick={() => {
            clicks += 1;
            setOn((v) => !v);
          }}
        >
          {on ? 'On' : 'Off'}
        </AgentToggle>
      );
    }
    render(
      <EmbinderProvider>
        <Controlled />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'notify', { on: true });
    await waitFor(() => expect(clicks).toBe(1));
    callTool(ws, 'notify', { on: true }); // already on -> no extra click
    await new Promise((r) => setTimeout(r, 50));
    expect(clicks).toBe(1);
  });
});
