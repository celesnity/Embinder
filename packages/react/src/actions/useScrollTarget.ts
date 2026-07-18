// Marks an element as an agent-scrollable destination for as long as it is mounted.
import { useCallback } from 'react';
import { setScrollTarget, removeScrollTarget } from './registry.js';

export interface ScrollTargetConfig { id: string; label: string; }

export function useScrollTarget(cfg: ScrollTargetConfig): { ref: (el: Element | null) => void } {
  const { id, label } = cfg;
  const ref = useCallback(
    (el: Element | null) => {
      if (el) setScrollTarget({ id, label, el });
      else removeScrollTarget(id);
    },
    [id, label],
  );
  return { ref };
}
