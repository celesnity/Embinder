# Agent-Driven UI Actions — Design

**Date:** 2026-07-18
**Status:** Approved (design), pending implementation plan
**Component:** `@embinder/react` (SDK), `@embinder/relay` (unchanged), `apps/todo` (reference)

## Summary

Add three first-class, agent-invocable UI actions to the SDK — **drag-and-drop**, **scroll-to**, and **navigate / swap-page** — beyond today's per-tool `useWebMCP` model. Apps opt in declaratively; the agent triggers real DOM interactions; the ghost cursor physically drives them; everything rides the existing one-gate approval pipeline.

## Locked Decisions

1. **Declarative helpers** — apps opt participants in via typed hooks (not generic "do anything" DOM access).
2. **Real DOM event synthesis** — the SDK dispatches genuine pointer/drag/scroll events so third-party libraries (dnd-kit, native scroll, router links) react as if a human acted.
3. **App-declared handles (id + label)** — helpers mark elements with a stable `id` and human `label`; the generated tool's schema enumerates the live ids/labels so the LLM chooses from a validated menu and the SDK maps `id → live DOM node`.
4. **Cursor drives the events** — the ghost cursor glides source→target and emits the pointer path frame-by-frame; what you see is what drives the DOM. Honors `prefers-reduced-motion` by collapsing the path while still emitting the full event sequence.
5. **Same gate, per-action risk defaults** — reuse `runGatedCall`. `scroll_to` auto-approves; `drag_and_drop` and `navigate` are destructive-by-default (approval required), overridable per element/route.

## Architecture

Each helper is a **capability registration** that contributes to **one WebMCP tool per action kind** (not per element). Elements self-register into a per-kind registry as they mount and unregister on unmount; the tool's input schema is regenerated from the live registry so the agent always sees the current valid ids/labels.

```
apps/todo (author)                packages/react (SDK)                 packages/relay
─────────────────                 ────────────────────                 ──────────────
useDraggable('card',{id,label}) ─┐
useDropZone('column',{id,label})─┤→ action registry (per kind)
useScrollTarget({id,label})     ─┤        │  registers ONE tool per kind:
useRoute(...)                   ─┘        │    drag_and_drop / scroll_to / navigate
                                          ▼
                                   synthesis engine  ◄── ghost cursor (drives pointer path)
                                          │
                                          ▼
                              document.modelContext shim ──ws──►  runGatedCall (one gate)
```

### New files (`packages/react/src/actions/`)

- `registry.ts` — per-kind maps of `id → { el, label, meta }`, plus a subscribe mechanism to trigger tool-schema refresh on add/remove.
- `synthesize.ts` — event-synthesis primitives (pointer drag, scroll, click), advanced frame-by-frame by the ghost cursor.
- `useDraggable.ts`, `useDropZone.ts`, `useScrollTarget.ts`, `useRoute.ts` — the app-facing hooks.
- `registerActionTools.ts` — builds the one-per-kind tools, regenerates their JSON Schema from the registry, and routes each `execute` into the synthesis engine.

### Ghost cursor change

The existing ghost cursor (`ghost-cursor.ts`) gains a **"perform" mode**: instead of only gliding to a target for show, it can be told "drag from A to B" and it becomes the pointer emitter along its own animated bezier path. Idle wandering and agent-glide behavior are unchanged.

## App-Side API

Each helper returns props spread onto the real element (like `grabAnchor`) and self-registers for its lifetime.

```tsx
// Drag-and-drop: mark sources and targets
const cardProps = useDraggable('card', { id: task.id, label: task.text });
const colProps  = useDropZone('column', { id: 'done', label: 'Done', accepts: ['card'] });
<li {...cardProps}>…</li>
<div {...colProps}>…</div>

// Scroll: mark a destination
const secProps = useScrollTarget({ id: 'settings', label: 'Settings section' });
<section {...secProps}>…</section>

// Navigate / swap page: declare routes with an app adapter (framework-agnostic)
useRoute(
  [
    { id: 'board',   label: 'Board',   path: '/' },
    { id: 'archive', label: 'Archive', path: '/archive' },
  ],
  { navigate: (path) => router.push(path) },
);
```

### Generated tools (what the agent sees)

- `drag_and_drop({ item: <enum of draggable ids>, onto: <enum of dropzone ids> })`
- `scroll_to({ target: <enum of scroll-target ids> })`
- `navigate({ page: <enum of route ids> })`

Enums + labels are injected into each tool's JSON Schema from the live registry, so the LLM picks from a validated menu and cannot name a stale or hidden element. Empty registry ⇒ the tool is unregistered (not offered) until a participant mounts.

### API design choices

- `accepts` on a dropzone constrains which draggable kinds may land there; drag is validated against it **before** synthesis, and an invalid pairing returns a tool error rather than a no-op.
- Drag and scroll need **no callback** — pure synthesis. An optional `onDrop` post-hook is available but not required.
- `navigate` requires an app-provided `navigate(path)` adapter because there is no universal DOM navigation event to synthesize. This is the one deliberate inconsistency: navigate is a semantic call; drag/scroll are synthesized. The ghost cursor still flies to the nav element for show.

## Synthesis Engine

One shared primitive, `performPointerPath(steps)`, advanced by the ghost cursor; each frame emits the matching real event at the cursor's current point.

**Drag-and-drop** (resolve `item`→sourceEl, `onto`→zoneEl from registry):

1. Glide cursor to source center → `pointerdown` (+ `dragstart` for HTML5 DnD libraries).
2. Each animation frame along the bezier to the target → `pointermove` / `dragover` at the cursor point, using `document.elementFromPoint` so `dragenter`/`dragleave` fire on whatever is actually under the cursor (real hover semantics).
3. Arrive at zone → `pointerup` (+ `drop`, `dragend`).
4. Await one animation frame, then resolve the tool result `{ ok, item, onto }`.

**Scroll**: resolve target → `el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' })`; the cursor rides along. A real scroll, so sticky/virtualized lists behave correctly.

**Navigate**: resolve route id → call the app's `navigate(path)` adapter; cursor flies to the nav element for show.

### Fidelity details

- Emits **both** Pointer Events and legacy HTML5 Drag events, so dnd-kit's pointer sensor and native `draggable` elements both respond.
- `document.elementFromPoint` at each step drives correct enter/leave targeting.
- Honors `prefers-reduced-motion`: collapses the path to start+end keyframes (near-instant) while still emitting the full event sequence — identical behavior, just faster.
- Each `execute` returns a Promise that resolves only when the performance completes, so the agent's next step waits for the UI to settle (no races).

## Gate & Risk

Reuses `runGatedCall` and `riskOf` unchanged. The generated tools carry annotations:

| Tool            | Annotation              | Default gate      | Override |
|-----------------|-------------------------|-------------------|----------|
| `scroll_to`     | `readOnlyHint: true`    | auto-approve      | —        |
| `drag_and_drop` | `destructiveHint: true` | approval required | `destructive: false` per dropzone/kind |
| `navigate`      | `destructiveHint: true` | approval required | `destructive: false` per route |

Approval flow, audit log, ghost-cursor pending/denied states, and inline Approve/Deny all work with **zero gate changes** because these are ordinary declared tools. On a pending decision, the cursor freezes mid-flight until approved (then completes the performance) or denied (then aborts and returns a denied result).

## Testing (final step)

The SDK currently has no test harness; this establishes one, run as the last implementation step after all actions and the reference wiring are in place.

- **Unit** (`vitest` + `jsdom`): registry add/remove/schema-refresh; `useRoute` adapter invocation; risk classification of generated tools. jsdom cannot do real layout/`elementFromPoint`, so these cover logic, not motion.
- **Integration** (`@vitest/browser` or Playwright component test): the real proof. Mount a dnd-kit list, fire `drag_and_drop` through the tool, assert the list reordered. One end-to-end test per action kind (drag, scroll, navigate).
- **Reference app**: all three wired into `apps/todo` (draggable cards, droppable columns, a scroll target, a two-route archive view) as the living demo and manual verification surface.

## Phasing (code all, then test)

1. **Foundation** — action registry + `registerActionTools` + schema refresh.
2. **Scroll** — simplest synthesis, auto-approved; proves tool-generation + cursor-ride end to end.
3. **Navigate** — adapter + per-route risk + approval on a non-synthesized action.
4. **Drag-and-drop** — pointer + HTML5 events, cursor-driven path, `elementFromPoint`; the headline feature.
5. **Reference-app wiring** — all three into `apps/todo`.
6. **Testing** — stand up the harness, then unit + integration (per-kind) + manual reference-app verification, all at once.

## Scope Guardrails (YAGNI)

Explicitly **out** of this spec: multi-select drag, free-form "click anywhere," resize/rotate gestures, keyboard-driven DnD, cross-window/iframe targeting, and generic DOM access. Only the three declared action kinds.
