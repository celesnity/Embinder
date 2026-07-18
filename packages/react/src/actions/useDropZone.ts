// Registers an element as an agent drop target. Returns a ref plus optional native-DnD
// convenience handlers (unused when the host already wires its own onDrop).
import { useCallback } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import { setDropZone, removeDropZone } from './registry.js';
import { EMBINDER_DND_MIME } from './useDraggable.js';

export interface DropZoneConfig {
  id: string;
  label: string;
  accepts?: string[];
  destructive?: boolean;
  onDrop?: (itemId: string, zoneId: string) => void;
}

export function useDropZone(
  kind: string,
  cfg: DropZoneConfig,
): { ref: (el: Element | null) => void; onDragOver: (e: ReactDragEvent) => void; onDrop: (e: ReactDragEvent) => void } {
  const { id, label, accepts, destructive, onDrop } = cfg;
  const ref = useCallback(
    (el: Element | null) => {
      if (el) setDropZone({ kind, id, label, el, accepts, destructive });
      else removeDropZone(id);
    },
    [kind, id, label, destructive, (accepts ?? []).join(',')],
  );
  const onDragOver = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);
  const handleDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      const itemId = e.dataTransfer.getData(EMBINDER_DND_MIME);
      if (itemId) onDrop?.(itemId, id);
    },
    [id, onDrop],
  );
  return { ref, onDragOver, onDrop: handleDrop };
}
