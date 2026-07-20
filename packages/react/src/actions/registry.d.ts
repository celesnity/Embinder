export interface Draggable {
    kind: string;
    id: string;
    label: string;
    el: Element;
}
export interface DropZone {
    kind: string;
    id: string;
    label: string;
    el: Element;
    accepts?: string[];
    destructive?: boolean;
}
export interface ScrollTarget {
    id: string;
    label: string;
    el: Element;
}
export interface RouteDef {
    id: string;
    label: string;
    path: string;
    destructive?: boolean;
}
type Listener = () => void;
export declare function subscribe(fn: Listener): () => void;
export declare const registry: {
    draggables: ReadonlyMap<string, Draggable>;
    dropzones: ReadonlyMap<string, DropZone>;
    scrollTargets: ReadonlyMap<string, ScrollTarget>;
    routes: ReadonlyMap<string, RouteDef>;
    readonly navigateAdapter: ((path: string) => void) | undefined;
};
export declare function setDraggable(d: Draggable): void;
export declare function removeDraggable(id: string): void;
export declare function setDropZone(z: DropZone): void;
export declare function removeDropZone(id: string): void;
export declare function setScrollTarget(s: ScrollTarget): void;
export declare function removeScrollTarget(id: string): void;
export declare function setRoutes(list: RouteDef[]): void;
export declare function clearRoutes(ids: string[]): void;
export declare function setNavigateAdapter(fn: ((path: string) => void) | undefined): void;
export {};
