import type { DragEvent as ReactDragEvent } from 'react';
export interface DropZoneConfig {
    id: string;
    label: string;
    accepts?: string[];
    destructive?: boolean;
    onDrop?: (itemId: string, zoneId: string) => void;
}
export declare function useDropZone(kind: string, cfg: DropZoneConfig): {
    ref: (el: Element | null) => void;
    onDragOver: (e: ReactDragEvent) => void;
    onDrop: (e: ReactDragEvent) => void;
};
