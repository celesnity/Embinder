/** Visual-motion preference shared by the mascot and action spotlight. */
export type EmbinderMotionMode = 'system' | 'full' | 'reduced' | 'off';

export interface EmbinderMotionPolicy {
  readonly mode: EmbinderMotionMode;
  readonly reduced: boolean;
  readonly hidden: boolean;
  subscribe(listener: (reduced: boolean) => void): () => void;
  destroy(): void;
}

function resolveReduced(mode: EmbinderMotionMode, systemReduced: boolean): boolean {
  return mode === 'reduced' || (mode === 'system' && systemReduced);
}

/**
 * Creates a page-local policy. `system` follows live OS/browser preference changes; the other
 * modes are explicit user choices. A provider owns one policy and shares it with all visuals.
 */
export function createEmbinderMotionPolicy(
  mode: EmbinderMotionMode = 'system',
): EmbinderMotionPolicy {
  const media = typeof window === 'undefined' || !window.matchMedia
    ? undefined
    : window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = resolveReduced(mode, media?.matches ?? false);
  const listeners = new Set<(value: boolean) => void>();

  const onMediaChange = () => {
    const next = resolveReduced(mode, media?.matches ?? false);
    if (next === reduced) return;
    reduced = next;
    for (const listener of listeners) listener(reduced);
  };

  if (mode === 'system') media?.addEventListener('change', onMediaChange);

  return {
    mode,
    get reduced() { return reduced; },
    get hidden() { return mode === 'off'; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      media?.removeEventListener('change', onMediaChange);
      listeners.clear();
    },
  };
}
