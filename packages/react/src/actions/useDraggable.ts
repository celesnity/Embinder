// Registers an element as an agent-draggable item. Returns a ref for registration plus
// optional native-DnD convenience props (unused when the host already wires its own).
import { useCallback } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import { setDraggable, removeDraggable } from './registry.js';

export const EMBINDER_DND_MIME = 'application/x-embinder-id';

export interface DraggableConfig { id: string; label: string; }

export function useDraggable(
  kind: string,
  cfg: DraggableConfig,
): { ref: (el: Element | null) => void; draggable: true; onDragStart: (e: ReactDragEvent) => void } {
  const { id, label } = cfg;
  const ref = useCallback(
    (el: Element | null) => {
      if (el) setDraggable({ kind, id, label, el });
      else removeDraggable(id);
    },
    [kind, id, label],
  );
  const onDragStart = useCallback(
    (e: ReactDragEvent) => {
      e.dataTransfer.setData(EMBINDER_DND_MIME, id);
      e.dataTransfer.effectAllowed = 'move';
    },
    [id],
  );
  return { ref, draggable: true, onDragStart };
}
