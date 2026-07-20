# AgentList — declarative agent-drivable collections

**Date:** 2026-07-19
**Package:** `@embinder/react`
**Status:** Design approved, pending spec review

## Problem

The eight existing agent components (`AgentButton`, `AgentInput`, `AgentSelect`, `AgentDiv`,
`AgentCheckbox`, `AgentRadioGroup`, `AgentToggle`, `AgentLink`) all register a tool by a unique
`name` per mount. That makes them fit **singleton** controls only. The most common real-world
interaction — acting on an item in a **list** (a task card, a table row, a menu entry) — cannot
be expressed with them:

- Wrapping each row in `<AgentButton name="toggle_task">` **collides**: every mounted row
  registers the same name (last-mount-wins error).
- Giving each row a unique name (`toggle_task_t1`, `toggle_task_t2`, …) **explodes** the tool
  count to O(items × actions), flooding the agent and fighting the SDK's "fewer tools" thesis.

Today the correct pattern is imperative: one id-parameterized tool (`toggle_task({id})`) declared
via `useEmbinder`, plus `grabAnchor('toggle_task')` on every row. This works but has two costs:

1. **No declarative ergonomics** for lists — the developer hand-writes the tool + anchors.
2. **Imprecise spotlight/ghost.** Every row shares `data-embinder-tool="toggle_task"`, so when
   the agent calls `toggle_task({id:'t3'})` the spotlight highlights the **first** matching row,
   not `t3`'s row. The live action visualization points at the wrong element.

## Goals

- A declarative `<AgentList>` component that makes a whole collection agent-drivable.
- Stay on-thesis: **O(actions) tools, not O(items)** — one id-parameterized tool per action.
- **Per-item precision:** the spotlight and ghost cursor land on the exact row the agent acted
  on, resolved from the call's `id` argument.
- Reuse the existing pipeline (`useEmbinder` → relay → gate → spotlight); no new relay/wire
  protocol changes.

## Non-goals (YAGNI)

- Single-select of one value — that is `AgentSelect`.
- Drag-and-drop of items — that is `useDraggable` / `useDropZone`.
- List virtualization, pagination, or an auto-rendered container element.
- Wiring `AgentList` into `apps/todo` is an **optional** final demo/verification task, not part
  of the core component.

## Architecture

### Component API

```tsx
<AgentList
  name="task"                 // collection id → tool + anchor namespace
  items={tasks}               // T[]
  getId={t => t.id}           // (item: T) => string  — stable, unique per item
  describe={t => `Task "${t.text}" (${t.done ? 'done' : 'open'})`} // (item: T) => string
  actions={{
    toggle: { description: 'Toggle done',  run: t => dispatch({ type: 'TOGGLE_TASK', id: t.id }) },
    delete: { description: 'Delete task', destructive: true,
              run: t => dispatch({ type: 'DELETE_TASK', id: t.id }) },
    edit:   { description: 'Change text', input: { text: z.string() },
              run: (t, args) => dispatch({ type: 'EDIT_TASK', id: t.id, patch: { text: args.text } }) },
  }}
  renderItem={(t, anchor) => <article {...anchor}><TaskCard task={t} /></article>}
/>
```

`AgentList` renders `<>{items.map(item => renderItem(item, anchorFor(getId(item))))}</>` — a
**fragment**, no wrapper element (the parent keeps its own container, e.g. a board column). It
performs all tool registration through `useEmbinder`.

### Types

```ts
interface AgentAction<T> {
  description: string;
  destructive?: boolean;
  title?: string;
  /** Zod raw shape for extra agent-supplied args beyond the item id. Omitted => id-only. */
  input?: Record<string, ZodTypeAny>;
  /** Runs the action for the resolved item. args is {} when no input schema. */
  run: (item: T, args: Record<string, unknown>) => unknown | Promise<unknown>;
}

interface AgentItemAnchor {
  'data-embinder-item': string;
}

interface AgentListProps<T> {
  name: string;
  items: T[];
  getId: (item: T) => string;
  describe: (item: T) => string;
  actions: Record<string, AgentAction<T>>;
  renderItem: (item: T, anchor: AgentItemAnchor) => ReactNode;
}

function AgentList<T>(props: AgentListProps<T>): ReactElement;
```

### What it registers

For a collection `name` with `actions = { toggle, delete, edit }`:

- **One tool per action**, named `` `${actionKey}_${name}` `` → `toggle_task`, `delete_task`,
  `edit_task`. Each tool's input schema is `{ id: z.string(), ...action.input }`. The handler
  resolves the item by `id` (via `getId`) among the current `items`, then calls `action.run(item, rest)`.
  - `destructive` on an action sets `destructiveHint` (policy file still authoritative), so the
    call routes through the human gate exactly like any other destructive tool.
  - Unknown or missing `id` (no current item matches) → returns a benign error result
    `{ error: 'item_not_found', id }` and does **not** call `run` (mirrors `AgentSelect`'s
    unknown-value no-op). The tool result reports it; nothing throws.
- **One context-only pointer** named `` `${name}_items` `` that live-pushes
  `{ items: [{ id, label }] }` where `label = describe(item)`, so the agent can enumerate what
  currently exists and choose a valid `id`. Uses the existing debounced `context()` mechanism
  (registered with no handler → `embinderContextOnly: true`).

Tool count is `actions.length + 1` regardless of how many items are on screen.

### Registration mechanics

- The component holds a ref to the latest `items`, `getId`, `actions`, `describe` (so handlers
  invoked later always see current data, mirroring `useEmbinder`'s latest-closure handling).
- It calls `useEmbinder` once per action tool plus once for the `${name}_items` context pointer.
  Because `useEmbinder`'s registration effect is keyed on the tool `name`, the set of registered
  tools is stable across item changes; only the context snapshot updates as `items` change.
- Action-set changes (adding/removing an action key) across renders are a developer error in the
  same class as changing a component's identity; the initial `actions` keys define the tools.
  (Document: the `actions` map shape should be stable for the life of the list.)

### Per-item spotlight / ghost precision

Each rendered item spreads the returned `anchor` (`data-embinder-item="<id>"`) onto its root
element. Resolution changes (additive):

- **Phase events already carry the call args.** `runGatedCall` emits
  `intent { id, name, argsPreview }`; `argsPreview` includes the item `id` the agent passed.
- `spotlight.ts` and `ghost-cursor.ts`: on the `intent` phase, capture `argsPreview?.id` into the
  active-call state. When resolving the target element, prefer, in order:
  1. `[data-embinder-tool="<name>"]` (existing singleton resolution), then
  2. if none and an item `id` was captured, `[data-embinder-item="<id>"]`.
  Item `id`s are unique on the page, so the item selector uniquely identifies the row.
- No new phase-event fields and no relay changes — this reads data the intent event already sends.

## Error handling / edge cases

- **No `EmbinderProvider` above the component:** `useEmbinder` already warns; unchanged.
- **Duplicate item ids** (`getId` collides): the tool resolves the first match; the anchor
  selector also matches the first. Document that `getId` must be unique; do not add runtime cost
  to detect it beyond an optional dev warning.
- **Empty `items`:** tools still register (agent can see the collection exists); the context
  pointer pushes `{ items: [] }`.
- **Action `run` throws:** surfaced through the tool result via the existing provider `.catch`.
- **id present but item removed between `tools/list` and the call:** treated as `item_not_found`.
- **Large context (> 16KB):** existing `CONTEXT_MAX_BYTES` truncation in `useEmbinder` applies.

## File layout

```
packages/react/src/components/
  AgentList.tsx        // the component + AgentAction / AgentListProps types
packages/react/src/
  spotlight.ts         // item-anchor resolution fallback (touched)
  ghost-cursor.ts      // item-anchor resolution fallback (touched)
  index.ts             // export AgentList + types
  components/index.ts  // barrel: export AgentList + types
```

## Testing / verification

- **Unit (vitest, jsdom)** in `AgentList.test.tsx`:
  - Registers exactly one tool per action (`toggle_task`, `delete_task`, `edit_task`) plus the
    `task_items` context-only pointer; asserts names, input schemas (`id` required; `edit` also
    has `text`), and `destructiveHint` on `delete`.
  - Calling `toggle_task` with a valid `id` invokes that item's `run` with the resolved item;
    `edit_task` passes `{ text }`.
  - Calling with an unknown `id` → `{ error: 'item_not_found', id }`, `run` not called.
  - The `task_items` context snapshot lists `{ id, label }` for current items and updates when
    `items` change.
  - Each rendered item carries `data-embinder-item="<id>"`.
- **`npm run typecheck`** — exit 0 across workspaces.
- **`npm test --workspace @embinder/react`** — full suite green (existing + new).
- **Spotlight/ghost per-item precision** is visual — covered by a manual note (F-D8), not a unit
  test. The resolution helper (name-first, item-fallback) can be unit-tested in isolation if
  extracted as a pure function.

## Optional follow-up (flagged, not in the core plan)

- Replace `apps/todo`'s imperative per-card tools (`toggle_task`, `edit_task`, `delete_task`) with
  a single `<AgentList name="task">`, removing those `useEmbinder` declarations from `tools.ts`
  and the `grabAnchor` calls from `TaskCard`. This proves the pattern end-to-end and fixes the
  real per-item spotlight bug in the reference app.
