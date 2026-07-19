// packages/react/src/components/AgentList.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { z } from 'zod';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

type Task = { id: string; text: string; done: boolean };
const seed: Task[] = [
  { id: 't1', text: 'milk', done: false },
  { id: 't2', text: 'eggs', done: true },
];

async function renderList(over: Record<string, unknown> = {}) {
  const { EmbinderProvider, AgentList } = await loadSdk();
  const toggle = vi.fn();
  const remove = vi.fn();
  const edit = vi.fn();
  const utils = render(
    <EmbinderProvider>
      <AgentList
        name="task"
        items={seed}
        getId={(t: Task) => t.id}
        describe={(t: Task) => `Task "${t.text}" (${t.done ? 'done' : 'open'})`}
        actions={{
          toggle: { description: 'Toggle done', run: (t: Task) => toggle(t.id) },
          delete: { description: 'Delete task', destructive: true, run: (t: Task) => remove(t.id) },
          edit: {
            description: 'Change text',
            input: { text: z.string() },
            run: (t: Task, a: Record<string, unknown>) => edit(t.id, a.text),
          },
          ...over,
        }}
        renderItem={(t: Task, anchor) => (
          <article {...anchor} data-testid={`row-${t.id}`}>{t.text}</article>
        )}
      />
    </EmbinderProvider>,
  );
  return { ...utils, toggle, remove, edit };
}

describe('AgentList', () => {
  it('registers one tool per action + a context-only pointer, with correct schemas', async () => {
    const { getByTestId } = await renderList();
    // each item is anchored by id
    expect(getByTestId('row-t1').getAttribute('data-embinder-item')).toBe('t1');

    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBeGreaterThanOrEqual(4));
    const regs = ws.ofType('register') as Array<{ tool: Record<string, any> }>;
    const byName = (n: string) => regs.find((r) => r.tool.name === n)!.tool;

    expect(byName('toggle_task').inputSchema.properties.id.type).toBe('string');
    expect(byName('toggle_task').inputSchema.required).toContain('id');
    expect(byName('delete_task').annotations.destructiveHint).toBe(true);
    expect(byName('edit_task').inputSchema.properties.text.type).toBe('string');
    expect(byName('task_items').annotations.embinderContextOnly).toBe(true);
  });

  it('pushes the item list (id + label) as live context', async () => {
    await renderList();
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('context').some((c) => c.name === 'task_items')).toBe(true));
    const snap = ws.ofType('context').find((c) => c.name === 'task_items') as { state: any };
    expect(snap.state.items).toEqual([
      { id: 't1', label: 'Task "milk" (open)' },
      { id: 't2', label: 'Task "eggs" (done)' },
    ]);
  });

  it('runs the targeted item action by id, passing extra args', async () => {
    const { toggle, edit } = await renderList();
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBeGreaterThanOrEqual(4));

    callTool(ws, 'toggle_task', { id: 't2' });
    await waitFor(() => expect(toggle).toHaveBeenCalledWith('t2'));

    callTool(ws, 'edit_task', { id: 't1', text: 'bread' });
    await waitFor(() => expect(edit).toHaveBeenCalledWith('t1', 'bread'));
  });

  it('returns item_not_found for an unknown id and does not run', async () => {
    const { toggle } = await renderList();
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBeGreaterThanOrEqual(4));

    callTool(ws, 'toggle_task', { id: 'nope' });
    await waitFor(() => expect(ws.ofType('result').length).toBe(1));
    expect(ws.ofType('result')[0]).toMatchObject({ result: { error: 'item_not_found', id: 'nope' } });
    expect(toggle).not.toHaveBeenCalled();
  });
});
