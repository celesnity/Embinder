import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentSelect', () => {
  it('registers a { value } tool and reports options + current value as live state', async () => {
    const { EmbinderProvider, AgentSelect } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentSelect name="priority" description="Task priority" defaultValue="low">
          <option value="low">Low</option>
          <option value="high">High</option>
        </AgentSelect>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties.value.type).toBe('string');
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({
      name: 'priority',
      state: { value: 'low', options: ['low', 'high'], disabled: false },
    });
  });

  it('selects the option and fires onChange when the agent sets a valid value', async () => {
    const { EmbinderProvider, AgentSelect } = await loadSdk();
    const seen: string[] = [];
    function Controlled() {
      const [v, setV] = useState('low');
      return (
        <AgentSelect
          name="priority"
          description="x"
          value={v}
          onChange={(e) => {
            seen.push(e.target.value);
            setV(e.target.value);
          }}
        >
          <option value="low">Low</option>
          <option value="high">High</option>
        </AgentSelect>
      );
    }
    render(
      <EmbinderProvider>
        <Controlled />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'priority', { value: 'high' });
    await waitFor(() => expect(seen).toContain('high'));
  });
});
