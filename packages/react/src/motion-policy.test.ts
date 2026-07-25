import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmbinderMotionPolicy } from './motion-policy.js';

type ChangeListener = () => void;

function installMotionMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<ChangeListener>();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return matches; },
    addEventListener: (_: string, listener: ChangeListener) => listeners.add(listener),
    removeEventListener: (_: string, listener: ChangeListener) => listeners.delete(listener),
  })));
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Embinder motion policy', () => {
  it('follows live system reduced-motion changes', () => {
    const media = installMotionMedia(true);
    const policy = createEmbinderMotionPolicy('system');
    const observed: boolean[] = [];
    policy.subscribe((reduced) => observed.push(reduced));

    expect(policy.reduced).toBe(true);
    media.set(false);

    expect(policy.reduced).toBe(false);
    expect(observed).toEqual([false]);
    policy.destroy();
  });

  it('honours an explicit full-motion choice over the system preference', () => {
    installMotionMedia(true);
    const policy = createEmbinderMotionPolicy('full');

    expect(policy.reduced).toBe(false);
    expect(policy.hidden).toBe(false);
    policy.destroy();
  });

  it('keeps the mascot hidden only when explicitly turned off', () => {
    installMotionMedia(false);
    const policy = createEmbinderMotionPolicy('off');

    expect(policy.hidden).toBe(true);
    expect(policy.reduced).toBe(false);
    policy.destroy();
  });
});
