import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentRadioGroup', () => {
  it('registers one { value } tool and reports child radio options + checked value', async () => {
    const { EmbinderProvider, AgentRadioGroup } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentRadioGroup name="size" description="T-shirt size">
          <label><input type="radio" name="size" value="s" defaultChecked /> S</label>
          <label><input type="radio" name="size" value="m" /> M</label>
        </AgentRadioGroup>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties.value.type).toBe('string');
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({
      name: 'size',
      state: { value: 's', options: ['s', 'm'] },
    });
  });

  it('checks the matching radio and fires its onChange; unknown value no-ops', async () => {
    const { EmbinderProvider, AgentRadioGroup } = await loadSdk();
    const seen: string[] = [];
    function Controlled() {
      const [v, setV] = useState('s');
      const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        seen.push(e.target.value);
        setV(e.target.value);
      };
      return (
        <AgentRadioGroup name="size" description="x">
          <label><input type="radio" name="size" value="s" checked={v === 's'} onChange={onChange} /> S</label>
          <label><input type="radio" name="size" value="m" checked={v === 'm'} onChange={onChange} /> M</label>
        </AgentRadioGroup>
      );
    }
    render(
      <EmbinderProvider>
        <Controlled />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'size', { value: 'm' });
    await waitFor(() => expect(seen).toContain('m'));
    callTool(ws, 'size', { value: 'xl' }); // unknown -> no throw, no new onChange
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).not.toContain('xl');
  });
});
