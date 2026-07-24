import { describe, expect, it, vi } from 'vitest';
import { subscribeEmbinderAppEvent } from './provider.js';

describe('subscribeEmbinderAppEvent', () => {
  it('forwards relay app events and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEmbinderAppEvent(listener);
    window.dispatchEvent(new CustomEvent('embinder:app-event', { detail: { name: 'blackboard-enrich-result', todoTaskId: 't1' } }));
    expect(listener).toHaveBeenCalledWith({ name: 'blackboard-enrich-result', todoTaskId: 't1' });
    unsubscribe();
    window.dispatchEvent(new CustomEvent('embinder:app-event', { detail: { name: 'ignored' } }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
