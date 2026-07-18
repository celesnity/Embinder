# Agent-Driven UI Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three app-declared, agent-invocable UI actions — `ui_scroll_to`, `ui_navigate`, `ui_drag_and_drop` — to `@embinder/react`, executed by real DOM-event synthesis and physically driven by the ghost cursor, then wired into the existing Kanban reference app, all riding the existing relay gate.

**Architecture:** Each action *kind* is one WebMCP tool whose input-schema enum is regenerated from a live registry that elements self-register into via hooks (registration-first: the hooks return a `ref`; the app keeps its own DnD/route behavior). Tool `execute` runs a cursor-driven synthesis engine that dispatches genuine pointer/drag/scroll events, driving the app's existing handlers. Navigation is a semantic call through an app-provided adapter. No relay changes.

**Tech Stack:** TypeScript (strict), React 19, `document.modelContext` relay shim, `requestAnimationFrame` + native `PointerEvent`/`DragEvent`/`MouseEvent`, vitest (jsdom) for unit + `@vitest/browser` (Playwright provider) for integration.

## Global Constraints

- Node `>=20`; packages are consumed from source (`main: ./src/index.ts`) — **no build step**, verify with `npm run typecheck`.
- **Zero new runtime dependencies** in `@embinder/react`. `@dnd-kit/core` may be added only as a `devDependency` test fixture.
- **Zero relay changes** — action tools are ordinary declared tools; risk is expressed only via `annotations.destructiveHint`/`readOnlyHint` (per-tool, decided at registration).
- **Tool names are namespaced `ui_`** (`ui_scroll_to`, `ui_navigate`, `ui_drag_and_drop`) so built-ins never collide with app-authored tools — the reference app already ships its own `scroll_to`, `go_to_page`, `move_task`.
- **Registration-first hooks:** the drag/drop/scroll hooks return a `ref` for registration; the reference app already owns the DnD/route behavior, so synthesis drives the app's existing `onDragStart`/`onDrop` handlers (which use the `text/plain` MIME → `MOVE_TASK`). Convenience handlers on the hooks are optional and unused in this integration.
- Zero cost when unused: no top-level side effects; the ghost-cursor + synthesis stay dynamically imported behind `viz`.
- Follow existing file conventions: leading `//` header comment describing the file's role; CSS prefixes `gmc-`/`emb-`; 2-space indent; named exports.
- All new SDK source lives under `packages/react/src/actions/`.
- Per-tool risk defaults: `ui_scroll_to` = `readOnlyHint` (auto-approve); `ui_drag_and_drop` and `ui_navigate` = `destructiveHint` unless **every** registered entry of that kind sets `destructive: false` (tool-level granularity — per-call risk is explicitly out of scope).

---

## File Structure

**Create (`packages/react/src/actions/`):**
- `registry.ts` — per-kind maps (`draggables`, `dropzones`, `scrollTargets`, `routes`) + navigate adapter + microtask-batched `subscribe`.
- `ghost-bridge.ts` — module holder decoupling synthesis from the ghost cursor.
- `synthesize.ts` — `performScroll`, `performDrag`, cursor-driven `ghostPath`; native event emitters.
- `registerActionTools.ts` — `installActionTools(ctx)`: builds/reconciles the three `ui_*` tools from the registry.
- `useScrollTarget.ts`, `useRoute.ts`, `useDraggable.ts`, `useDropZone.ts` — the app hooks.
- `index.ts` — barrel.

**Modify (SDK):**
- `packages/react/src/ghost-cursor.ts` — add "perform" mode (`driveTo`/`release`) + register controller.
- `packages/react/src/index.ts` — re-export the hooks.
- `packages/react/src/provider.tsx` — call `installActionTools(singleton.modelContext)` once.

**Modify (reference app):**
- `apps/todo/src/App.tsx` — `useRoute` adapter (→ `SET_ROUTE`) + a scroll target on the header.
- `apps/todo/src/components/Board.tsx` — extract the inline column into a `Column` component.
- `apps/todo/src/components/Column.tsx` (Create) — calls `useDropZone` + `useScrollTarget`, renders the existing column markup.
- `apps/todo/src/components/TaskCard.tsx` — call `useDraggable`, attach its `ref`.

**Test (final task):**
- `packages/react/vitest.config.ts`, `packages/react/test/registry.test.ts`, `test/registerActionTools.test.ts`, `test/synthesize.browser.test.tsx`.

> **Phasing note (per request):** production code first (Tasks 1–5), automated tests last (Task 6). Each code task ends with `npm run typecheck` + a concrete manual verification, then a commit.

---

## Task 1: Foundation — registry, ghost bridge, ghost perform mode, synthesis engine, tool installer

**Files:**
- Create: `packages/react/src/actions/registry.ts`, `ghost-bridge.ts`, `synthesize.ts`, `registerActionTools.ts`
- Modify: `packages/react/src/ghost-cursor.ts`, `packages/react/src/provider.tsx`

**Interfaces:**
- Produces:
  - `registry.ts`: types `Draggable`, `DropZone`, `ScrollTarget`, `RouteDef`; setters `setDraggable(d)`, `removeDraggable(id)`, `setDropZone(z)`, `removeDropZone(id)`, `setScrollTarget(s)`, `removeScrollTarget(id)`, `setRoutes(list)`, `clearRoutes(ids)`, `setNavigateAdapter(fn)`; readonly `registry`; `subscribe(fn): () => void`.
  - `registerActionTools.ts`: `installActionTools(ctx: ModelContextSurface): void`.
  - `ghost-bridge.ts`: `interface GhostController { driveTo(x,y): void; release(): void }`, `setGhostController`, `getGhostController`.

- [ ] **Step 1: Create the registry**

Create `packages/react/src/actions/registry.ts`:

```ts
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
```

- [ ] **Step 2: Create the ghost bridge**

Create `packages/react/src/actions/ghost-bridge.ts`:

```ts
// Decouples the synthesis engine from the ghost cursor. The cursor registers a
// controller when viz is on; synthesis drives it if present, else runs headless.
export interface GhostController {
  /** Move the mascot's finger-tip to a viewport point (px). */
  driveTo(x: number, y: number): void;
  /** Hand control back to idle wandering. */
  release(): void;
}

let controller: GhostController | undefined;

export function setGhostController(c: GhostController | undefined): void { controller = c; }
export function getGhostController(): GhostController | undefined { return controller; }
```

- [ ] **Step 3: Add perform mode to the ghost cursor**

In `packages/react/src/ghost-cursor.ts`, add the import after the existing `import type { PhaseMessage }` line:

```ts
import { setGhostController } from './actions/ghost-bridge.js';
```

Inside `createGhostCursor`, add a flag right after `let mode: Mode = 'idle';`:

```ts
  let performing = false; // true while the synthesis engine drives the cursor
```

In the `engine` function, change the early `busy` guard from:

```ts
    if (mode === 'busy') {
      trail(); // trail the flight to the target too
      return;
    }
```

to:

```ts
    if (performing || mode === 'busy') {
      trail(); // trail the driven drag / the flight to the target too
      return;
    }
```

Immediately after the `wanderPos(cx, cy);` "Appear immediately" line, register the controller:

```ts
  setGhostController({
    driveTo(px: number, py: number) {
      performing = true;
      el.style.transition = 'none';
      cancelReturn();
      el.classList.add('is-working');
      wanderPos(px - HOTX * SIZE, py - HOTY * SIZE); // finger-tip lands on (px,py)
    },
    release() {
      performing = false;
      el.classList.remove('is-working');
      setMode('idle'); // resume wandering from here
    },
  });
```

In `destroy()`, add as the first line (before `cancelReturn();`):

```ts
      setGhostController(undefined);
```

- [ ] **Step 4: Create the synthesis engine**

Create `packages/react/src/actions/synthesize.ts`:

```ts
// Real DOM-event synthesis, driven frame-by-frame by the ghost cursor. Emits both
// Pointer Events (dnd-kit et al.) and legacy HTML5 Drag/Mouse events (native draggable),
// so it drives whatever handlers the app already has wired.
import { getGhostController } from './ghost-bridge.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function firePointer(el: Element, type: string, x: number, y: number): void {
  el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
    pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, view: window,
  }));
}
function fireMouse(el: Element, type: string, x: number, y: number): void {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window }));
}
function fireDrag(el: Element, type: string, x: number, y: number, dt: DataTransfer): void {
  const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window });
  Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true }); // dataTransfer is readonly on construct
  el.dispatchEvent(ev);
}

// Animate a bezier from → to, calling onFrame each step; drive the mascot if present.
function ghostPath(from: { x: number; y: number }, to: { x: number; y: number }, onFrame: (x: number, y: number) => void): Promise<void> {
  const ghost = getGhostController();
  if (reduce()) {
    ghost?.driveTo(to.x, to.y);
    onFrame(to.x, to.y);
    return Promise.resolve();
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const dur = Math.min(1000, Math.max(400, dist * 1.2));
  const ctrl = {
    x: (from.x + to.x) / 2 + (to.y - from.y) * 0.2,
    y: (from.y + to.y) / 2 - (to.x - from.x) * 0.2,
  };
  const start = performance.now();
  return new Promise<void>((resolve) => {
    function step(now: number): void {
      const t = Math.min(1, (now - start) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const u = 1 - e;
      const x = u * u * from.x + 2 * u * e * ctrl.x + e * e * to.x;
      const y = u * u * from.y + 2 * u * e * ctrl.y + e * e * to.y;
      ghost?.driveTo(x, y);
      onFrame(x, y);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

export async function performScroll(el: Element): Promise<void> {
  const ghost = getGhostController();
  const c = center(el);
  ghost?.driveTo(c.x, c.y);
  el.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center', inline: 'center' });
  await wait(reduce() ? 0 : 500);
  ghost?.release();
}

export async function performDrag(source: Element, target: Element): Promise<void> {
  const ghost = getGhostController();
  const dt = new DataTransfer();
  const from = center(source);
  const to = center(target);
  try {
    firePointer(source, 'pointerdown', from.x, from.y);
    fireMouse(source, 'mousedown', from.x, from.y);
    fireDrag(source, 'dragstart', from.x, from.y, dt);

    let last: Element = source;
    await ghostPath(from, to, (x, y) => {
      const under = document.elementFromPoint(x, y) ?? target;
      firePointer(under, 'pointermove', x, y);
      fireMouse(under, 'mousemove', x, y);
      if (under !== last) {
        fireDrag(last, 'dragleave', x, y, dt);
        fireDrag(under, 'dragenter', x, y, dt);
        last = under;
      }
      fireDrag(under, 'dragover', x, y, dt);
    });

    const under = document.elementFromPoint(to.x, to.y) ?? target;
    fireDrag(under, 'drop', to.x, to.y, dt);
    fireDrag(source, 'dragend', to.x, to.y, dt);
    firePointer(under, 'pointerup', to.x, to.y);
    fireMouse(under, 'mouseup', to.x, to.y);
  } finally {
    ghost?.release();
  }
}
```

- [ ] **Step 5: Create the tool installer**

Create `packages/react/src/actions/registerActionTools.ts`:

```ts
// Builds one WebMCP tool per action kind from the live registry and re-registers it
// (fresh schema) whenever participants change. Tools are ui_-namespaced to avoid
// colliding with app-authored tools. Each execute routes into synthesis.
import type { ModelContextSurface, ToolDescriptor } from '../model-context.js';
import { registry, subscribe } from './registry.js';
import { performScroll, performDrag } from './synthesize.js';

interface ToolSpec { name: string; descriptor: ToolDescriptor; }

function enumProp(entries: { id: string; label: string }[], desc: string) {
  return {
    type: 'string',
    enum: entries.map((e) => e.id),
    description: `${desc} Options: ${entries.map((e) => `${e.id} (${e.label})`).join(', ')}`,
  };
}

function buildSpecs(): ToolSpec[] {
  const specs: ToolSpec[] = [];

  const scrolls = [...registry.scrollTargets.values()];
  if (scrolls.length) {
    specs.push({
      name: 'ui_scroll_to',
      descriptor: {
        name: 'ui_scroll_to',
        title: 'Scroll to',
        description: 'Smoothly scroll a declared section into view.',
        inputSchema: { type: 'object', required: ['target'], properties: { target: enumProp(scrolls, 'Which section to scroll to.') } },
        annotations: { title: 'Scroll to', readOnlyHint: true },
        execute: async (args: unknown) => {
          const { target } = (args ?? {}) as { target?: string };
          const t = target ? registry.scrollTargets.get(target) : undefined;
          if (!t) throw new Error(`unknown scroll target: ${target}`);
          await performScroll(t.el);
          return { ok: true, target };
        },
      },
    });
  }

  const routes = [...registry.routes.values()];
  if (routes.length) {
    const destructive = routes.some((r) => r.destructive !== false);
    specs.push({
      name: 'ui_navigate',
      descriptor: {
        name: 'ui_navigate',
        title: 'Navigate',
        description: 'Navigate to a declared page/route.',
        inputSchema: { type: 'object', required: ['page'], properties: { page: enumProp(routes, 'Which page to open.') } },
        annotations: { title: 'Navigate', destructiveHint: destructive },
        execute: async (args: unknown) => {
          const { page } = (args ?? {}) as { page?: string };
          const r = page ? registry.routes.get(page) : undefined;
          if (!r) throw new Error(`unknown route: ${page}`);
          const nav = registry.navigateAdapter;
          if (!nav) throw new Error('no navigate adapter registered');
          nav(r.path);
          return { ok: true, page, path: r.path };
        },
      },
    });
  }

  const items = [...registry.draggables.values()];
  const zones = [...registry.dropzones.values()];
  if (items.length && zones.length) {
    const destructive = zones.some((z) => z.destructive !== false);
    specs.push({
      name: 'ui_drag_and_drop',
      descriptor: {
        name: 'ui_drag_and_drop',
        title: 'Drag and drop',
        description: 'Drag a declared item onto a declared drop zone.',
        inputSchema: {
          type: 'object',
          required: ['item', 'onto'],
          properties: { item: enumProp(items, 'Which item to drag.'), onto: enumProp(zones, 'Which zone to drop it on.') },
        },
        annotations: { title: 'Drag and drop', destructiveHint: destructive },
        execute: async (args: unknown) => {
          const { item, onto } = (args ?? {}) as { item?: string; onto?: string };
          const d = item ? registry.draggables.get(item) : undefined;
          const z = onto ? registry.dropzones.get(onto) : undefined;
          if (!d) throw new Error(`unknown item: ${item}`);
          if (!z) throw new Error(`unknown zone: ${onto}`);
          if (z.accepts && !z.accepts.includes(d.kind)) throw new Error(`zone ${onto} does not accept ${d.kind}`);
          await performDrag(d.el, z.el);
          return { ok: true, item, onto };
        },
      },
    });
  }

  return specs;
}

let installed = false;

export function installActionTools(ctx: ModelContextSurface): void {
  if (installed) return;
  installed = true;
  const current = new Map<string, AbortController>();

  const reconcile = (): void => {
    const specs = buildSpecs();
    const want = new Set(specs.map((s) => s.name));
    for (const [name, ac] of [...current]) {
      if (!want.has(name)) { ac.abort(); current.delete(name); }
    }
    for (const s of specs) {
      current.get(s.name)?.abort(); // drop stale schema, register fresh
      const ac = new AbortController();
      current.set(s.name, ac);
      ctx.registerTool(s.descriptor, { signal: ac.signal });
    }
  };

  subscribe(reconcile);
  reconcile();
}
```

- [ ] **Step 6: Install from the provider**

In `packages/react/src/provider.tsx`, add the import near the other local imports:

```ts
import { installActionTools } from './actions/registerActionTools.js';
```

Inside `EmbinderProvider`, right after `ensureShim(url, token);`, add:

```ts
  // Register the built-in action tools (scroll/navigate/drag) through the relay shim.
  useEffect(() => {
    if (singleton) installActionTools(singleton.modelContext);
  }, []);
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w @embinder/react`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/actions packages/react/src/ghost-cursor.ts packages/react/src/provider.tsx
git commit -m "feat(actions): registry, synthesis engine, ghost perform mode, ui_ tool installer"
```

---

## Task 2: Scroll action — useScrollTarget hook + header target

**Files:**
- Create: `packages/react/src/actions/useScrollTarget.ts`, `packages/react/src/actions/index.ts`
- Modify: `packages/react/src/index.ts`, `apps/todo/src/App.tsx`

**Interfaces:**
- Consumes: `setScrollTarget`, `removeScrollTarget`.
- Produces: `useScrollTarget({ id, label }): { ref: (el: Element | null) => void }`.

- [ ] **Step 1: Create the hook**

Create `packages/react/src/actions/useScrollTarget.ts`:

```ts
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
```

- [ ] **Step 2: Create the actions barrel**

Create `packages/react/src/actions/index.ts`:

```ts
export { useScrollTarget } from './useScrollTarget.js';
export type { ScrollTargetConfig } from './useScrollTarget.js';
```

- [ ] **Step 3: Re-export from the package entry**

In `packages/react/src/index.ts`, add before the final `export type { ChatBubbleConfig }` line:

```ts
// Agent-driven UI action hooks (declare participants; the SDK generates the tools).
export * from './actions/index.js';
```

- [ ] **Step 4: Register a scroll target on the app header**

In `apps/todo/src/App.tsx`, update the import line:

```ts
import { grabAnchor, useScrollTarget } from '@embinder/react';
```

Inside `App`, after the `useBoardTools(stateRef, dispatch);` line, add:

```ts
  const topTarget = useScrollTarget({ id: 'app-top', label: 'Top of the app' });
```

Attach its ref to the existing header — change `<header id="board-top" className="app-head">` to:

```tsx
      <header id="board-top" ref={topTarget.ref} className="app-head">
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open http://localhost:5173, scroll the page down, open the chat bubble, send: `scroll to the top of the app`.
Expected: the mascot flies to the header and the page smooth-scrolls it into view; the agent reports `{ ok: true, target: "app-top" }`; no gate prompt (auto-approved). (More scroll targets — the columns — are added in Task 4.)

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/actions/useScrollTarget.ts packages/react/src/actions/index.ts packages/react/src/index.ts apps/todo/src/App.tsx
git commit -m "feat(actions): ui_scroll_to + useScrollTarget + header target"
```

---

## Task 3: Navigate action — useRoute hook + board page routing

**Files:**
- Create: `packages/react/src/actions/useRoute.ts`
- Modify: `packages/react/src/actions/index.ts`, `apps/todo/src/App.tsx`

**Interfaces:**
- Consumes: `setRoutes`, `clearRoutes`, `setNavigateAdapter`, type `RouteDef`.
- Produces: `useRoute(routes: RouteDef[], opts: { navigate: (path: string) => void }): void`.

- [ ] **Step 1: Create the hook**

Create `packages/react/src/actions/useRoute.ts`:

```ts
// Declares navigable pages and the app's navigate adapter (router-agnostic).
import { useEffect } from 'react';
import { setRoutes, clearRoutes, setNavigateAdapter, type RouteDef } from './registry.js';

export function useRoute(routes: RouteDef[], opts: { navigate: (path: string) => void }): void {
  const key = routes.map((r) => `${r.id}:${r.path}:${r.destructive ?? ''}`).join('|');
  useEffect(() => {
    setRoutes(routes);
    return () => clearRoutes(routes.map((r) => r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    setNavigateAdapter(opts.navigate);
    return () => setNavigateAdapter(undefined);
  }, [opts.navigate]);
}
```

- [ ] **Step 2: Export the hook + shared types**

In `packages/react/src/actions/index.ts`, add:

```ts
export { useRoute } from './useRoute.js';
export type { RouteDef, Draggable, DropZone, ScrollTarget } from './registry.js';
```

- [ ] **Step 3: Wire routes into App via SET_ROUTE**

In `apps/todo/src/App.tsx`, update the import to add `useRoute`:

```ts
import { grabAnchor, useScrollTarget, useRoute } from '@embinder/react';
```

Inside `App`, after the `topTarget` line, add (uses the existing `PAGES` import and `dispatch`; `path` is just the page id):

```ts
  useRoute(
    PAGES.map((p) => ({
      id: p,
      label: p[0].toUpperCase() + p.slice(1),
      path: p,
      destructive: p === 'board' ? false : undefined,
    })),
    { navigate: (path) => dispatch({ type: 'SET_ROUTE', route: path as Page }) },
  );
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open the bubble, send: `navigate to the settings page`.
Expected: an approval prompt (navigate destructive by default); after Approve, the app routes to Settings and the address hash becomes `#/settings`; agent reports `{ ok: true, page: "settings", path: "settings" }`. Sending `go to the board` (route `board`, `destructive:false`) navigates with no prompt. Note this is distinct from the app's own `go_to_page` tool — both work; `ui_navigate` is the SDK built-in.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/actions/useRoute.ts packages/react/src/actions/index.ts apps/todo/src/App.tsx
git commit -m "feat(actions): ui_navigate + useRoute wired to SET_ROUTE"
```

---

## Task 4: Drag-and-drop — useDraggable/useDropZone + Column refactor driving the real board

**Files:**
- Create: `packages/react/src/actions/useDraggable.ts`, `packages/react/src/actions/useDropZone.ts`, `apps/todo/src/components/Column.tsx`
- Modify: `packages/react/src/actions/index.ts`, `apps/todo/src/components/Board.tsx`, `apps/todo/src/components/TaskCard.tsx`

**Interfaces:**
- Consumes: `setDraggable`, `removeDraggable`, `setDropZone`, `removeDropZone`, `setScrollTarget`, `removeScrollTarget`.
- Produces:
  - `useDraggable(kind, { id, label }): { ref, draggable, onDragStart }` (only `ref` is used here; the app keeps its own drag handlers).
  - `useDropZone(kind, { id, label, accepts?, destructive?, onDrop? }): { ref, onDragOver, onDrop }` (only `ref` used here).

- [ ] **Step 1: Create useDraggable**

Create `packages/react/src/actions/useDraggable.ts`:

```ts
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
```

- [ ] **Step 2: Create useDropZone**

Create `packages/react/src/actions/useDropZone.ts`:

```ts
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
```

- [ ] **Step 3: Export the hooks**

In `packages/react/src/actions/index.ts`, add:

```ts
export { useDraggable, EMBINDER_DND_MIME } from './useDraggable.js';
export type { DraggableConfig } from './useDraggable.js';
export { useDropZone } from './useDropZone.js';
export type { DropZoneConfig } from './useDropZone.js';
```

- [ ] **Step 4: Register each TaskCard as a draggable**

In `apps/todo/src/components/TaskCard.tsx`, update the SDK import:

```ts
import { grabAnchor, useDraggable } from '@embinder/react';
```

Inside `TaskCard`, before `return (`, add:

```ts
  const drag = useDraggable('card', { id: task.id, label: task.text });
```

Attach the registration ref to the existing `<article>` — the card already sets `draggable` + `onDragStart` (which writes `text/plain`), so we only add the ref. Change the opening tag to:

```tsx
    <article
      ref={drag.ref}
      className={`card${task.done ? ' done' : ''}`}
      draggable={draggable}
```

- [ ] **Step 5: Extract a Column component that is a drop zone + scroll target**

Create `apps/todo/src/components/Column.tsx` (moves the per-column JSX out of `Board`; registers the column as a `ui_drag_and_drop` zone and a `ui_scroll_to` target; keeps the app's existing native drop behavior):

```tsx
import { useState } from 'react';
import { grabAnchor, useDropZone, useScrollTarget } from '@embinder/react';
import { type Action, type Column as Col, type State, tasksInColumn } from '../store';
import { TaskCard } from './TaskCard';

export function Column({ col, state, dispatch }: { col: Col; state: State; dispatch: (a: Action) => void }) {
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const tasks = tasksInColumn(state, col.id);

  const zone = useDropZone('column', { id: col.id, label: col.title, accepts: ['card'] });
  const scroll = useScrollTarget({ id: `col-${col.id}`, label: `${col.title} column` });
  const setRefs = (el: HTMLElement | null) => { zone.ref(el); scroll.ref(el); };

  const submitAdd = () => {
    const text = draft.trim();
    if (text) dispatch({ type: 'ADD_TASK', task: { text, columnId: col.id } });
    setDraft('');
    setAdding(false);
  };

  return (
    <section
      ref={setRefs}
      className={`col${over ? ' drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id) dispatch({ type: 'MOVE_TASK', id, columnId: col.id });
        setOver(false);
      }}
    >
      <header className="col-head">
        <input
          className="col-title"
          value={col.title}
          {...grabAnchor('rename_column')}
          onChange={(e) => dispatch({ type: 'RENAME_COLUMN', id: col.id, title: e.target.value })}
        />
        <span className="count">{tasks.length}</span>
        <button
          className="col-x"
          {...grabAnchor('delete_column')}
          onClick={() => dispatch({ type: 'DELETE_COLUMN', id: col.id })}
          title="Delete column and its tasks"
        >
          ✕
        </button>
      </header>

      <div className="col-body">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} dispatch={dispatch} />
        ))}
        {tasks.length === 0 && <p className="col-empty">Drop tasks here</p>}
      </div>

      {adding ? (
        <input
          className="col-add-input"
          autoFocus
          value={draft}
          placeholder="Task title…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submitAdd}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAdd();
            if (e.key === 'Escape') { setDraft(''); setAdding(false); }
          }}
        />
      ) : (
        <button className="col-add" {...grabAnchor('add_task')} onClick={() => { setDraft(''); setAdding(true); }}>
          + Add task
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Slim Board down to map over Column**

Replace the entire contents of `apps/todo/src/components/Board.tsx` with:

```tsx
import { grabAnchor } from '@embinder/react';
import { type Action, type State } from '../store';
import { Column } from './Column';

export function Board({ state, dispatch }: { state: State; dispatch: (a: Action) => void }) {
  const columns = [...state.columns].sort((a, b) => a.order - b.order);
  return (
    <div className="board-cols">
      {columns.map((col) => (
        <Column key={col.id} col={col} state={state} dispatch={dispatch} />
      ))}
      <button
        className="col-new"
        {...grabAnchor('add_column')}
        onClick={() => dispatch({ type: 'ADD_COLUMN', title: 'New column' })}
      >
        + Add column
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Manual verification**

Run: `npm run dev` on the board page. Open the bubble, send: `drag the "Install the SDK" card onto the To Do column` (any real card text/column).
Expected: an approval prompt (drag destructive); after Approve the mascot glides from the card to the target column leaving a trail, the card moves columns (real `MOVE_TASK` via the app's native `onDrop`), and the agent reports `{ ok: true, item: "<card id>", onto: "<column id>" }`. Confirm a human can still drag cards between columns. Also `scroll to the Done column` now works (column scroll targets).

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/actions apps/todo/src/components
git commit -m "feat(actions): ui_drag_and_drop + Column refactor driving the real board"
```

---

## Task 5: Cohesion pass — all three actions on the live board

**Files:**
- Modify: `apps/todo/src/App.tsx` (only if a bracket/scope fix is needed)

**Interfaces:** none new.

- [ ] **Step 1: Verify the three actions coexist**

Confirm on the running app: `ui_scroll_to` (header + each column), `ui_navigate` (4 pages), `ui_drag_and_drop` (cards → columns) all appear as agent tools and don't collide with the app's own `scroll_to`/`go_to_page`/`move_task`.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Manual verification — full flow in one chat session**

Run: `npm run dev`. Send in sequence: `scroll to the Done column` (no prompt) → `drag <card> onto In Progress` (Approve → card moves) → `navigate to analytics` (Approve → routes) → `go to the board` (no prompt, returns).
Expected: each behaves as described; the ghost cursor drives every motion and returns to wandering between actions.

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add apps/todo/src
git commit -m "chore(demo): verify three SDK actions on the live board"
```

---

## Task 6: Automated tests (final step)

**Files:**
- Create: `packages/react/vitest.config.ts`, `packages/react/test/registry.test.ts`, `test/registerActionTools.test.ts`, `test/synthesize.browser.test.tsx`
- Modify: `packages/react/package.json`

- [ ] **Step 1: Add test tooling**

In `packages/react/package.json`, add to `devDependencies`: `"vitest": "^3.0.0"`, `"jsdom": "^25.0.0"`, `"@vitest/browser": "^3.0.0"`, `"playwright": "^1.48.0"`, `"@dnd-kit/core": "^6.1.0"`, `"react": "^19.0.0"`, `"react-dom": "^19.0.0"`. Add to `scripts`: `"test": "vitest run"`.

Run: `npm install`
Expected: installs without error.

- [ ] **Step 2: Vitest config (jsdom + browser projects)**

Create `packages/react/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'jsdom', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'browser',
          include: ['test/**/*.browser.test.tsx'],
          browser: { enabled: true, provider: 'playwright', instances: [{ browser: 'chromium' }], headless: true },
        },
      },
    ],
  },
});
```

- [ ] **Step 3: Registry unit test — write it**

Create `packages/react/test/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registry, subscribe, setScrollTarget, removeScrollTarget, setDraggable, setDropZone } from '../src/actions/registry.js';

describe('registry', () => {
  beforeEach(() => {
    for (const id of [...registry.scrollTargets.keys()]) removeScrollTarget(id);
  });

  it('adds and removes scroll targets', () => {
    const el = document.createElement('div');
    setScrollTarget({ id: 's1', label: 'One', el });
    expect(registry.scrollTargets.get('s1')?.label).toBe('One');
    removeScrollTarget('s1');
    expect(registry.scrollTargets.has('s1')).toBe(false);
  });

  it('notifies subscribers once per microtask batch', async () => {
    let calls = 0;
    const unsub = subscribe(() => { calls++; });
    const el = document.createElement('div');
    setDraggable({ kind: 'card', id: 'd1', label: 'D1', el });
    setDropZone({ kind: 'card', id: 'z1', label: 'Z1', el });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1); // batched
    unsub();
  });
});
```

- [ ] **Step 4: Run registry test**

Run: `npm test -w @embinder/react -- --project unit registry`
Expected: PASS (2 tests).

- [ ] **Step 5: Tool-generation unit test — write it**

Create `packages/react/test/registerActionTools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ModelContextSurface, ToolDescriptor } from '../src/model-context.js';
import { installActionTools } from '../src/actions/registerActionTools.js';
import { setScrollTarget, setDraggable, setDropZone } from '../src/actions/registry.js';

describe('registerActionTools', () => {
  it('registers ui_scroll_to with an enum of ids and readOnly risk', async () => {
    const registered: ToolDescriptor[] = [];
    const ctx: ModelContextSurface = { registerTool: (d) => void registered.push(d) };
    installActionTools(ctx);

    setScrollTarget({ id: 'about', label: 'About', el: document.createElement('div') });
    await Promise.resolve();
    await Promise.resolve();

    const scroll = registered.find((d) => d.name === 'ui_scroll_to');
    expect(scroll).toBeTruthy();
    const schema = scroll!.inputSchema as { properties: { target: { enum: string[] } } };
    expect(schema.properties.target.enum).toContain('about');
    expect(scroll!.annotations?.readOnlyHint).toBe(true);
  });

  it('marks ui_drag_and_drop destructive and validates accepts on execute', async () => {
    const registered: ToolDescriptor[] = [];
    const ctx: ModelContextSurface = { registerTool: (d) => void registered.push(d) };
    installActionTools(ctx); // idempotent; same subscriber

    setDraggable({ kind: 'card', id: 'c1', label: 'C1', el: document.createElement('div') });
    setDropZone({ kind: 'card', id: 'colOnly', label: 'Col', el: document.createElement('div'), accepts: ['col'] });
    await Promise.resolve();
    await Promise.resolve();

    const drag = registered.reverse().find((d) => d.name === 'ui_drag_and_drop');
    expect(drag!.annotations?.destructiveHint).toBe(true);
    await expect(drag!.execute({ item: 'c1', onto: 'colOnly' })).rejects.toThrow(/does not accept/);
  });
});
```

- [ ] **Step 6: Run tool-generation test**

Run: `npm test -w @embinder/react -- --project unit registerActionTools`
Expected: PASS (2 tests).

- [ ] **Step 7: Drag synthesis browser test — write it**

Create `packages/react/test/synthesize.browser.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { performDrag } from '../src/actions/synthesize.js';

describe('performDrag (real events)', () => {
  it('fires the pointer + drag sequence landing on the target', async () => {
    document.body.innerHTML = '';
    const src = document.createElement('div');
    const tgt = document.createElement('div');
    for (const [el, x] of [[src, 10], [tgt, 300]] as const) {
      el.style.position = 'fixed';
      el.style.top = '10px';
      el.style.left = `${x}px`;
      el.style.width = '80px';
      el.style.height = '80px';
      document.body.appendChild(el);
    }

    const seen: string[] = [];
    src.addEventListener('dragstart', () => seen.push('dragstart'));
    src.addEventListener('pointerdown', () => seen.push('pointerdown'));
    tgt.addEventListener('drop', () => seen.push('drop'));
    tgt.addEventListener('pointerup', () => seen.push('pointerup'));

    await performDrag(src, tgt);

    expect(seen).toContain('pointerdown');
    expect(seen).toContain('dragstart');
    expect(seen).toContain('drop');
    expect(seen).toContain('pointerup');
  });
});
```

- [ ] **Step 8: Run browser test**

Run: `npx playwright install chromium` then `npm test -w @embinder/react -- --project browser`
Expected: PASS (1 test).

- [ ] **Step 9: Run the full suite**

Run: `npm test -w @embinder/react`
Expected: all projects PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/react/vitest.config.ts packages/react/test packages/react/package.json package-lock.json
git commit -m "test(actions): registry, ui_ tool-generation, and drag-synthesis coverage"
```

---

## Self-Review Notes

- **Spec coverage:** declarative helpers (Tasks 2–4) ✓; real DOM synthesis (Task 1 `synthesize.ts`) ✓; app-declared id+label handles + schema enums (Task 1) ✓; cursor drives events (Task 1 perform mode + `ghostPath`) ✓; same gate + per-action risk (Task 1 annotations, verified Task 6) ✓; scroll/navigate/drag (Tasks 2/3/4) ✓; reference app wired into the real board (Task 4 Column refactor) ✓; testing final step (Task 6) ✓.
- **Reference app reality:** the app already ships `scroll_to`/`go_to_page`/`move_task` tools and native `text/plain`→`MOVE_TASK` DnD. The SDK tools are `ui_`-namespaced to avoid collision, and the hooks register handles (`ref`) so synthesis drives the app's *existing* handlers rather than replacing them. This is why `useDraggable`/`useDropZone` convenience props go unused in the integration.
- **Known simplification vs spec:** risk is tool-level, not per-call. A route/zone `destructive:false` override only downgrades the tool when *all* entries of that kind opt out. Per-call risk would need a relay-side `riskOf(args)` change, which the spec excluded ("zero gate changes").
- **Known limitations:** (1) `ui_scroll_to` only reaches currently-mounted targets — no cross-page switch like the app's own `scroll_to` (that behavior stays in the app tool). (2) The spotlight popover anchors to `[data-embinder-tool="<name>"]`, which action tools don't set, so it centers rather than hugging the source; the ghost cursor still drives the motion. Both are future polish, out of scope.
- **Type consistency:** `GhostController.driveTo/release`, `EMBINDER_DND_MIME`, `setRefs` composing `zone.ref`+`scroll.ref`, and the `ui_scroll_to`/`ui_navigate`/`ui_drag_and_drop` names are used identically across defining and consuming tasks. The `Column` type is imported as `type Column as Col` to avoid shadowing the `Column` component.
```
