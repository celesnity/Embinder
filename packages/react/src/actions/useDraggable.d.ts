import type { DragEvent as ReactDragEvent } from 'react';
export declare const EMBINDER_DND_MIME = "application/x-embinder-id";
export interface DraggableConfig {
    id: string;
    label: string;
}
export declare function useDraggable(kind: string, cfg: DraggableConfig): {
    ref: (el: Element | null) => void;
    draggable: true;
    onDragStart: (e: ReactDragEvent) => void;
};
