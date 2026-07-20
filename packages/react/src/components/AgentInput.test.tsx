import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentInput', () => {
  it('registers a { value } tool and pushes live value/placeholder/disabled', async () => {
    const { EmbinderProvider, AgentInput } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentInput name="task_text" description="The new task text" placeholder="Task…" defaultValue="milk" />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.name).toBe('task_text');
    expect(reg.tool.inputSchema.properties.value.type).toBe('string');
    expect(reg.tool.inputSchema.required).toEqual(['value']);
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({
      name: 'task_text',
      state: { value: 'milk', placeholder: 'Task…', disabled: false },
    });
  });

  it('sets the controlled value and fires the developer onChange when the agent calls it', async () => {
    const { EmbinderProvider, AgentInput } = await loadSdk();
    const seen: string[] = [];
    function Controlled() {
      const [v, setV] = useState('');
      return (
        <AgentInput
          name="task_text"
          description="x"
          value={v}
          onChange={(e) => {
            seen.push(e.target.value);
            setV(e.target.value);
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
    callTool(ws, 'task_text', { value: 'eggs' });
    await waitFor(() => expect(seen).toContain('eggs'));
  });
});
