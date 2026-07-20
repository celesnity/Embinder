import { describe, expect, it } from 'vitest';
import { ScopeTree } from './scope-tree.js';
import type { CapabilityDef } from './registry.js';

const def = (scopeId?: string): CapabilityDef => ({ config: {}, destructive: false, scopeId });
describe('ScopeTree', () => {
  it('reveals one child layer then restores root after one action', () => {
    const tree = new ScopeTree();
    tree.register({ id: 'inbox', name: 'inbox' }); tree.setContext('inbox', { count: 2 });
    const entries: Array<[string, CapabilityDef]> = [['add_task', def()], ['archive_task', def('inbox')]];
    expect(tree.visible(entries, 's1').map(([n]) => n)).toEqual(['add_task']);
    expect(tree.focus('s1', 'inbox')).toEqual({ ok: true, state: { count: 2 } });
    expect(tree.visible(entries, 's1').map(([n]) => n)).toEqual(['archive_task']);
    expect(tree.reserve('s1', 'inbox').ok).toBe(true);
    tree.settle('s1');
    expect(tree.visible(entries, 's1').map(([n]) => n)).toEqual(['add_task']);
  });
});
