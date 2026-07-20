// CapabilityRegistry — render-scoped membership with grace semantics (T2.1/T2.3, D-6).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapabilityRegistry, type CapabilityDef } from './registry.js';
import { requestApproval, cancelByTool, decide } from './approval.js';

const def = (): CapabilityDef => ({ config: { description: 'x' }, destructive: false });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('CapabilityRegistry', () => {
  it('shows scoped actions only after focus and rejects stale calls', () => {
    const reg = new CapabilityRegistry();
    reg.registerScope({ id: 'inbox', name: 'inbox' });
    reg.setScopeContext('inbox', { count: 2 });
    reg.register('add_task', def());
    reg.register('archive_task', { ...def(), scopeId: 'inbox' });
    expect(reg.selectedEntries('s1').map(([name]) => name)).toEqual(['add_task', 'focus_inbox']);
    expect(reg.reserveScopedAction('s1', 'archive_task')).toMatchObject({ ok: false, scoped: true });
    expect(reg.focus('s1', 'focus_inbox')).toEqual({ ok: true, state: { count: 2 } });
    expect(reg.selectedEntries('s1').map(([name]) => name)).toEqual(['archive_task']);
    expect(reg.reserveScopedAction('s1', 'archive_task')).toEqual({ scoped: true, ok: true });
    reg.settleScopedAction('s1');
    expect(reg.selectedEntries('s1').map(([name]) => name)).toEqual(['add_task', 'focus_inbox']);
  });

  it('stores context snapshots on registered capabilities', () => {
    const reg = new CapabilityRegistry();
    reg.register('task_board', def());
    reg.setContext('task_board', { tasks: ['milk'] });
    expect(reg.get('task_board')?.contextState).toEqual({ tasks: ['milk'] });
    expect(reg.get('task_board')?.contextTs).toBeTypeOf('number');
    // unknown names are ignored, not created
    reg.setContext('ghost', { x: 1 });
    expect(reg.get('ghost')).toBeUndefined();
  });

  it('rejects pending calls with a defined error after the grace window expires', async () => {
    const onRemove = vi.fn();
    const reg = new CapabilityRegistry({ graceMs: 2000, onRemove });
    reg.register('add_task', def());
    const outcome = new Promise((resolve, reject) => {
      reg.trackCall({ id: 'c1', name: 'add_task', args: {}, resolve, reject });
    });
    reg.unregister('add_task');
    expect(reg.get('add_task')).toBeDefined(); // still present during grace
    vi.advanceTimersByTime(2100);
    await expect(outcome).rejects.toThrow('capability "add_task" left the screen');
    expect(reg.get('add_task')).toBeUndefined();
    expect(onRemove).toHaveBeenCalledWith('add_task');
  });

  it('re-register within the grace window cancels removal and re-delivers pending calls', async () => {
    const onRemove = vi.fn();
    const onResend = vi.fn();
    const reg = new CapabilityRegistry({ graceMs: 2000, onRemove, onResend });
    reg.register('add_task', def());
    const outcome = new Promise((resolve, reject) => {
      reg.trackCall({ id: 'c1', name: 'add_task', args: { text: 'milk' }, resolve, reject });
    });
    reg.unregister('add_task');
    vi.advanceTimersByTime(500);
    reg.register('add_task', def()); // remount (quick tab flip)
    vi.advanceTimersByTime(5000);
    expect(onRemove).not.toHaveBeenCalled();
    expect(reg.get('add_task')).toBeDefined();
    expect(onResend).toHaveBeenCalledWith('c1', 'add_task', { text: 'milk' });
    reg.settle('c1', { ok: true });
    await expect(outcome).resolves.toEqual({ ok: true });
  });

  it('times out unanswered calls while the capability stays registered', async () => {
    const reg = new CapabilityRegistry({ callTimeoutMs: 30_000 });
    reg.register('add_task', def());
    const outcome = new Promise((resolve, reject) => {
      reg.trackCall({ id: 'c1', name: 'add_task', args: {}, resolve, reject });
    });
    vi.advanceTimersByTime(30_100);
    await expect(outcome).rejects.toThrow('timed out');
  });
});

describe('approval cancellation on unmount', () => {
  it('rejects a pending approval for an unmounted tool with an "unmounted" error', async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    const p = requestApproval(
      { id: 'a1', tool: 'delete_task', risk: 'destructive', argsRaw: {}, argsCanonical: {}, tampered: false },
      controller.signal,
    );
    cancelByTool('delete_task');
    await expect(p).rejects.toThrow('unmounted');
    // already-removed ids can no longer be decided
    expect(decide('a1', true, 'human')).toBe(false);
  });
});
