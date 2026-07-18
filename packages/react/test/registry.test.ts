import { describe, it, expect, beforeEach } from 'vitest';
import { registry, subscribe, setScrollTarget, removeScrollTarget, setDraggable, setDropZone } from '../src/actions/registry.js';

describe('registry', () => {
  beforeEach(() => {
    for (const id of [...registry.scrollTargets.keys()]) removeScrollTarget(id);
  });

  it('adds and removes scroll targets', () => {
    const el = document.createElement('div');
    setScrollTarget({ id: 's1', label: 'One', el });
    expect(registry.scrollTargets.get('s1')?.label).toBe('One');
    removeScrollTarget('s1');
    expect(registry.scrollTargets.has('s1')).toBe(false);
  });

  it('notifies subscribers once per microtask batch', async () => {
    let calls = 0;
    const unsub = subscribe(() => { calls++; });
    const el = document.createElement('div');
    setDraggable({ kind: 'card', id: 'd1', label: 'D1', el });
    setDropZone({ kind: 'card', id: 'z1', label: 'Z1', el });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1); // batched
    unsub();
  });
});
