// Live registry of app-declared action participants. Hooks add/remove entries as
// elements mount; registerActionTools subscribes and regenerates tool schemas.
export interface Draggable { kind: string; id: string; label: string; el: Element; }
export interface DropZone { kind: string; id: string; label: string; el: Element; accepts?: string[]; destructive?: boolean; }
export interface ScrollTarget { id: string; label: string; el: Element; }
export interface RouteDef { id: string; label: string; path: string; destructive?: boolean; }

const draggables = new Map<string, Draggable>();
const dropzones = new Map<string, DropZone>();
const scrollTargets = new Map<string, ScrollTarget>();
const routes = new Map<string, RouteDef>();
let navigateAdapter: ((path: string) => void) | undefined;

type Listener = () => void;
const listeners = new Set<Listener>();
let scheduled = false;
function notify(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const l of [...listeners]) l();
  });
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const registry = {
  draggables: draggables as ReadonlyMap<string, Draggable>,
  dropzones: dropzones as ReadonlyMap<string, DropZone>,
  scrollTargets: scrollTargets as ReadonlyMap<string, ScrollTarget>,
  routes: routes as ReadonlyMap<string, RouteDef>,
  get navigateAdapter(): ((path: string) => void) | undefined {
    return navigateAdapter;
  },
};

export function setDraggable(d: Draggable): void { draggables.set(d.id, d); notify(); }
export function removeDraggable(id: string): void { if (draggables.delete(id)) notify(); }
export function setDropZone(z: DropZone): void { dropzones.set(z.id, z); notify(); }
export function removeDropZone(id: string): void { if (dropzones.delete(id)) notify(); }
export function setScrollTarget(s: ScrollTarget): void { scrollTargets.set(s.id, s); notify(); }
export function removeScrollTarget(id: string): void { if (scrollTargets.delete(id)) notify(); }
export function setRoutes(list: RouteDef[]): void { for (const r of list) routes.set(r.id, r); notify(); }
export function clearRoutes(ids: string[]): void {
  let changed = false;
  for (const id of ids) changed = routes.delete(id) || changed;
  if (changed) notify();
}
export function setNavigateAdapter(fn: ((path: string) => void) | undefined): void {
  navigateAdapter = fn;
  notify();
}
