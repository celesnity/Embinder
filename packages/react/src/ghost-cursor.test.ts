import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGhostCursor } from './ghost-cursor.js';
import { createEmbinderMotionPolicy } from './motion-policy.js';

function installAnimationFrame() {
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  return {
    run(id: number, timestamp: number) {
      const callback = frames.get(id);
      if (!callback) throw new Error(`Animation frame ${id} was not scheduled`);
      frames.delete(id);
      callback(timestamp);
    },
    count() { return frames.size; },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('GhostCursor motion policy', () => {
  it('wanders in full-motion mode even when the device prefers reduced motion', () => {
    const frames = installAnimationFrame();
    const policy = createEmbinderMotionPolicy('full');
    const ghost = createGhostCursor(policy);
    const mascot = document.querySelector<HTMLElement>('.gmc-ghost')!;
    const before = mascot.style.transform;

    frames.run(1, 100);
    frames.run(2, 116);

    expect(mascot.classList.contains('is-motion-full')).toBe(true);
    expect(mascot.classList.contains('is-motion-reduced')).toBe(false);
    expect(mascot.style.transform).not.toBe(before);
    ghost.destroy();
    policy.destroy();
  });

  it('does not start a wander loop in reduced-motion mode', () => {
    const frames = installAnimationFrame();
    const policy = createEmbinderMotionPolicy('reduced');
    const ghost = createGhostCursor(policy);

    expect(document.querySelector('.gmc-ghost')?.classList.contains('is-motion-reduced')).toBe(true);
    expect(frames.count()).toBe(0);
    ghost.destroy();
    policy.destroy();
  });
});
