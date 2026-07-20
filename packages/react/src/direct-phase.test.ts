import { describe, expect, it } from 'vitest';
import { emitEmbinderPhase, subscribeEmbinderPhase } from './provider.js';

describe('direct UI visualization phases', () => {
  it('delivers a direct bridge focus phase to the Embinder visualizer subscriber', () => {
    const received: string[] = [];
    const unsubscribe = subscribeEmbinderPhase((phase) => received.push(`${phase.type}:${phase.name}`));

    emitEmbinderPhase({ type: 'focus', name: 'navigate_workflow_approvals' });
    unsubscribe();

    expect(received).toEqual(['focus:navigate_workflow_approvals']);
  });
});
