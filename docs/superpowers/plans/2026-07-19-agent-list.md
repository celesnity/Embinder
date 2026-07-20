# AgentList Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `AgentList` to `@embinder/react` — a declarative component that makes a whole collection agent-drivable via id-parameterized tools, plus per-item spotlight/ghost precision so the visualization lands on the exact row.

**Architecture:** `AgentList` renders a fragment of `renderItem` results (each item spreads a `data-embinder-item="<id>"` anchor) plus, per action, a tiny headless registrar child that makes a single `useEmbinder` call — reusing the existing registration/gate/context machinery with no rules-of-hooks hazard and no relay changes. A shared `resolveAgentTarget(name, itemId?)` helper adds an item-id fallback to the spotlight and ghost cursor, resolved from the `id` the intent phase already carries.

**Tech Stack:** TypeScript (ESM), React 19, Zod raw shapes, Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Package scope:** all changes under `packages/react/src/` (except the optional Task 5 in `apps/todo`). Do NOT modify `@embinder/relay`, the gate, or the wire protocol.
- **Module style:** ESM; intra-package imports use the `.js` extension (e.g. `../use-embinder.js`).
- **Register through `useEmbinder`:** `AgentList` registers tools only via the existing `useEmbinder` hook (through its headless registrar children) — never `getModelContext()`/`registerTool` directly.
- **Tool naming:** an action keyed `k` in a collection named `n` registers the tool `` `${k}_${n}` `` (e.g. `toggle` + `task` → `toggle_task`). The collection's context pointer is `` `${n}_items` ``.
- **Item anchor attribute:** `data-embinder-item` (exact string), value = `String(getId(item))`.
- **Tool count is O(actions), not O(items):** one tool per action + one context pointer, regardless of item count.
- **Unknown/missing id:** action handler returns `{ error: 'item_not_found', id }` and does NOT call `run`.
- **Typecheck gate:** `npm run typecheck` exit 0 across workspaces.
- **Test command (single file):** `npm test --workspace @embinder/react -- src/<PATH>.test.ts[x]`
- **Full suite:** `npm test --workspace @embinder/react`

---

## Reference: existing interfaces this plan consumes (do NOT change)

From `packages/react/src/use-embinder.ts`:

```ts
export interface EmbinderDescriptor {
  name: string;
  description: string;
  input?: Record<string, ZodTypeAny>;
  handler?: (args: never) => unknown | Promise<unknown>;
  context?: () => unknown;
  destructive?: boolean;
  title?: string;
}
export function useEmbinder(descriptor: EmbinderDescriptor): { 'data-embinder-tool': string };
```

Register/context wire shape asserted in tests (from `provider.tsx`):
- `register`: `{ type: 'register', tool: { name, title, description, inputSchema, annotations } }`
- `context`: `{ type: 'context', name, state }`
- incoming `call`: `{ type: 'call', id, name, args }` → shim runs the tool's execute → replies `{ type: 'result', id, result }`
- a pointer with a handler-less descriptor sets `annotations.embinderContextOnly = true`.

From `packages/react/src/spotlight.ts`:
```ts
export interface PhaseMessage {
  type: 'intent' | 'gate' | 'decided' | 'call' | 'done';
  id?: string; name?: string; argsPreview?: unknown;
  status?: 'auto' | 'awaiting'; decision?: 'approved' | 'denied';
}
```
The `intent` phase carries `argsPreview` = the canonical call args (e.g. `{ id: 't3' }`).

Shared test harness `packages/react/src/components/agent-test-harness.tsx` exports:
`setupFakeRelay()`, `loadSdk()`, `socket()`, `callTool(ws, name, args)`, `class FakeWebSocket`.

---

## File Structure

```
packages/react/src/
  resolve-target.ts          // NEW: resolveAgentTarget(name, itemId?) + EMBINDER_ITEM_ATTR
  resolve-target.test.ts     // NEW
  spotlight.ts               // MODIFY: use resolveAgentTarget; capture argsPreview.id
  ghost-cursor.ts            // MODIFY: use resolveAgentTarget; capture argsPreview.id
  components/
    AgentList.tsx            // NEW: AgentList + AgentAction/AgentListProps types + headless registrars
    AgentList.test.tsx       // NEW
    index.ts                 // MODIFY: export AgentList + types
  index.ts                   // MODIFY: export AgentList + types
apps/todo/src/               // Task 5 (OPTIONAL)
```

---

## Task 1: AgentList component

The core deliverable. Renders items with per-id anchors and registers, per action, a headless child that makes one `useEmbinder` call, plus one context-only pointer child.

**Files:**
- Create: `packages/react/src/components/AgentList.tsx`
- Create: `packages/react/src/components/AgentList.test.tsx`
- Modify: `packages/react/src/index.ts`
- Modify: `packages/react/src/components/index.ts`

**Interfaces:**
- Consumes: `useEmbinder` from `../use-embinder.js`; `z` from `zod`; the test harness.
- Produces:
  - `interface AgentAction<T> { description: string; destructive?: boolean; title?: string; input?: Record<string, ZodTypeAny>; run: (item: T, args: Record<string, unknown>) => unknown | Promise<unknown>; }`
  - `interface AgentListProps<T> { name: string; items: T[]; getId: (item: T) => string; describe: (item: T) => string; actions: Record<string, AgentAction<T>>; renderItem: (item: T, anchor: { 'data-embinder-item': string }) => ReactNode; }`
  - `function AgentList<T>(props: AgentListProps<T>): ReactElement`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/react/src/components/AgentList.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { z } from 'zod';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

type Task = { id: string; text: string; done: boolean };
const seed: Task[] = [
  { id: 't1', text: 'milk', done: false },
  { id: 't2', text: 'eggs', done: true },
];

async function renderList(over: Record<string, unknown> = {}) {
  const { EmbinderProvider, AgentList } = await loadSdk();
  const toggle = vi.fn();
  const remove = vi.fn();
  const edit = vi.fn();
  const utils = render(
    <EmbinderProvider>
      <AgentList
        name="task"
        items={seed}
        getId={(t: Task) => t.id}
        describe={(t: Task) => `Task "${t.text}" (${t.done ? 'done' : 'open'})`}
        actions={{
          toggle: { description: 'Toggle done', run: (t: Task) => toggle(t.id) },
          delete: { description: 'Delete task', destructive: true, run: (t: Task) => remove(t.id) },
          edit: {
            description: 'Change text',
            input: { text: z.string() },
            run: (t: Task, a: Record<string, unknown>) => edit(t.id, a.text),
          },
          ...over,
        }}
        renderItem={(t: Task, anchor) => (
          <article {...anchor} data-testid={`row-${t.id}`}>{t.text}</article>
        )}
      />
    </EmbinderProvider>,
  );
  return { ...utils, toggle, remove, edit };
}

describe('AgentList', () => {
  it('registers one tool per action + a context-only pointer, with correct schemas', async () => {
    const { getByTestId } = await renderList();
    // each item is anchored by id
    expect(getByTestId('row-t1').getAttribute('data-embinder-item')).toBe('t1');

    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBeGreaterThanOrEqual(4));
    const regs = ws.ofType('register') as Array<{ tool: Record<string, any> }>;
    const byName = (n: string) => regs.find((r) => r.tool.name === n)!.tool;

    expect(byName('toggle_task').inputSchema.properties.id.type).toBe('string');
    expect(byName('toggle_task').inputSchema.required).toContain('id');
    expect(byName('delete_task').annotations.destructiveHint).toBe(true);
    expect(byName('edit_task').inputSchema.properties.text.type).toBe('string');
    expect(byName('task_items').annotations.embinderContextOnly).toBe(true);
  });

  it('pushes the item list (id + label) as live context', async () => {
    await renderList();
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('context').some((c) => c.name === 'task_items')).toBe(true));
    const snap = ws.ofType('context').find((c) => c.name === 'task_items') as { state: any };
    expect(snap.state.items).toEqual([
      { id: 't1', label: 'Task "milk" (open)' },
      { id: 't2', label: 'Task "eggs" (done)' },
    ]);
  });

  it('runs the targeted item action by id, passing extra args', async () => {
    const { toggle, edit } = await renderList();
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBeGreaterThanOrEqual(4));

    callTool(ws, 'toggle_task', { id: 't2' });
    await waitFor(() => expect(toggle).toHaveBeenCalledWith('t2'));

    callTool(ws, 'edit_task', { id: 't1', text: 'bread' });
    await waitFor(() => expect(edit).toHaveBeenCalledWith('t1', 'bread'));
  });

  it('returns item_not_found for an unknown id and does not run', async () => {
    const { toggle } = await renderList();
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBeGreaterThanOrEqual(4));

    callTool(ws, 'toggle_task', { id: 'nope' });
    await waitFor(() => expect(ws.ofType('result').length).toBe(1));
    expect(ws.ofType('result')[0]).toMatchObject({ result: { error: 'item_not_found', id: 'nope' } });
    expect(toggle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/AgentList.test.tsx`
Expected: FAIL — `AgentList` is not exported.

- [ ] **Step 3: Write AgentList**

```tsx
// packages/react/src/components/AgentList.tsx
// Declarative agent-drivable collection. Renders items with a per-id anchor and registers,
// per action, a headless child that makes ONE useEmbinder call (reuses the existing
// registration/gate/context machinery; a keyed list of single-hook children avoids the
// rules-of-hooks hazard of calling useEmbinder in a loop). One context-only pointer
// (`${name}_items`) lets the agent enumerate ids. Tool count is O(actions), not O(items).
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { z, type ZodTypeAny } from 'zod';
import { useEmbinder } from '../use-embinder.js';

export interface AgentAction<T> {
  description: string;
  destructive?: boolean;
  title?: string;
  /** Zod raw shape for extra agent args beyond the item id. Omitted => id-only. */
  input?: Record<string, ZodTypeAny>;
  /** Runs the action for the resolved item; args is the extra input ({} when none). */
  run: (item: T, args: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface AgentListProps<T> {
  /** Collection id — namespaces the tools (`${key}_${name}`) and context (`${name}_items`). */
  name: string;
  items: T[];
  /** Stable, unique id per item. The agent targets items by this. */
  getId: (item: T) => string;
  /** Human label per item, surfaced to the agent in the `${name}_items` context. */
  describe: (item: T) => string;
  actions: Record<string, AgentAction<T>>;
  renderItem: (item: T, anchor: { 'data-embinder-item': string }) => ReactNode;
}

// One static useEmbinder call. Rendered once per action; a keyed list of these is safe
// (each child owns exactly one hook), unlike calling useEmbinder in a loop.
function ItemToolRegistrar<T>(props: {
  toolName: string;
  action: AgentAction<T>;
  items: T[];
  getId: (item: T) => string;
}): null {
  const { toolName, action, items, getId } = props;
  useEmbinder({
    name: toolName,
    title: action.title,
    description: action.description,
    destructive: action.destructive,
    input: { id: z.string().describe('The id of the target item'), ...(action.input ?? {}) },
    handler: ((args: { id: string } & Record<string, unknown>) => {
      const { id, ...rest } = args;
      const item = items.find((it) => getId(it) === id);
      if (!item) return { error: 'item_not_found', id };
      return action.run(item, rest);
    }) as (args: never) => unknown,
  });
  return null;
}

function CollectionContext<T>(props: {
  name: string;
  items: T[];
  getId: (item: T) => string;
  describe: (item: T) => string;
}): null {
  const { name, items, getId, describe } = props;
  useEmbinder({
    name,
    description: 'The current items in this collection (id + label). Use an id with the action tools.',
    context: () => ({ items: items.map((it) => ({ id: getId(it), label: describe(it) })) }),
  });
  return null;
}

export function AgentList<T>({
  name,
  items,
  getId,
  describe,
  actions,
  renderItem,
}: AgentListProps<T>): ReactElement {
  return (
    <>
      {Object.entries(actions).map(([key, action]) => (
        <ItemToolRegistrar key={key} toolName={`${key}_${name}`} action={action} items={items} getId={getId} />
      ))}
      <CollectionContext name={`${name}_items`} items={items} getId={getId} describe={describe} />
      {items.map((item) => (
        <Fragment key={getId(item)}>{renderItem(item, { 'data-embinder-item': String(getId(item)) })}</Fragment>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Export it (package entry + barrel)**

Append to `packages/react/src/index.ts`:

```ts
export { AgentList } from './components/AgentList.js';
export type { AgentListProps, AgentAction } from './components/AgentList.js';
```

Append to `packages/react/src/components/index.ts`:

```ts
export { AgentList } from './AgentList.js';
export type { AgentListProps, AgentAction } from './AgentList.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/AgentList.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace @embinder/react`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/components/AgentList.tsx packages/react/src/components/AgentList.test.tsx packages/react/src/index.ts packages/react/src/components/index.ts
git commit -m "feat(react): AgentList — declarative agent-drivable collections"
```

---

## Task 2: `resolveAgentTarget` helper

A pure DOM-resolution helper shared by the spotlight and ghost cursor: resolve a tool anchor by name (largest visible when several share it), else fall back to the specific item anchor by id.

**Files:**
- Create: `packages/react/src/resolve-target.ts`
- Create: `packages/react/src/resolve-target.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const EMBINDER_ITEM_ATTR = 'data-embinder-item'`
  - `function resolveAgentTarget(name: string, itemId?: string): Element | undefined`

- [ ] **Step 1: Write the failing test**

```ts
// packages/react/src/resolve-target.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolveAgentTarget } from './resolve-target.js';

function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html;
  const node = d.firstElementChild as HTMLElement;
  document.body.appendChild(node);
  return node;
}
function rect(node: HTMLElement, r: Partial<DOMRect>) {
  node.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, ...r }) as DOMRect;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('resolveAgentTarget', () => {
  it('resolves a single tool anchor by name', () => {
    const b = el('<button data-embinder-tool="undo">Undo</button>');
    expect(resolveAgentTarget('undo')).toBe(b);
  });

  it('among multiple tool anchors, picks the largest visible one', () => {
    const a = el('<button data-embinder-tool="del">a</button>');
    const b = el('<button data-embinder-tool="del">b</button>');
    rect(a, { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 });
    rect(b, { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 });
    expect(resolveAgentTarget('del')).toBe(b);
  });

  it('falls back to the item anchor by id when no tool anchor exists', () => {
    const row = el('<article data-embinder-item="t3">row</article>');
    expect(resolveAgentTarget('toggle_task', 't3')).toBe(row);
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveAgentTarget('missing', 'nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/resolve-target.test.ts`
Expected: FAIL — cannot resolve `./resolve-target.js`.

- [ ] **Step 3: Write the helper**

```ts
// packages/react/src/resolve-target.ts
// Resolve the DOM element an agent action targets. A tool anchored on one element resolves by
// its data-embinder-tool name; when several share it (same action on two pages) pick the one
// with the largest visible slice of the viewport. Collection item tools have no tool anchor —
// they resolve to the specific item by data-embinder-item, keyed on the call's id argument.

export const EMBINDER_ITEM_ATTR = 'data-embinder-item';

function largestVisible(nodes: ArrayLike<Element>): Element | undefined {
  let best: Element | undefined;
  let bestArea = -1;
  for (let i = 0; i < nodes.length; i++) {
    const r = nodes[i].getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue; // display:none / detached
    const vw = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const vh = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const area = vw * vh;
    if (area > bestArea) { bestArea = area; best = nodes[i]; }
  }
  return best;
}

export function resolveAgentTarget(name: string, itemId?: string): Element | undefined {
  const esc = window.CSS?.escape ?? ((x: string) => x);
  const byTool = document.querySelectorAll(`[data-embinder-tool="${esc(name)}"]`);
  if (byTool.length === 1) return byTool[0];
  if (byTool.length > 1) return largestVisible(byTool) ?? byTool[0];
  // No tool anchor (a collection item tool): resolve the specific item by id.
  if (itemId != null && itemId !== '') {
    const byItem = document.querySelectorAll(`[${EMBINDER_ITEM_ATTR}="${esc(itemId)}"]`);
    if (byItem.length) return largestVisible(byItem) ?? byItem[0];
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/resolve-target.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/resolve-target.ts packages/react/src/resolve-target.test.ts
git commit -m "feat(react): resolveAgentTarget — name-first, per-item fallback"
```

---

## Task 3: Wire per-item resolution into the spotlight and ghost cursor

Replace each file's private `resolveEl` with the shared helper, and capture the `id` from the intent phase's `argsPreview` so gated/acted items resolve to the exact row.

**Files:**
- Modify: `packages/react/src/spotlight.ts`
- Modify: `packages/react/src/ghost-cursor.ts`

**Interfaces:**
- Consumes: `resolveAgentTarget` from `./resolve-target.js` (Task 2); `PhaseMessage.argsPreview`.
- Produces: no new exports (internal behavior change).

- [ ] **Step 1: Update `spotlight.ts` — import, capture id, thread through `show`**

Replace the private `resolveEl` (lines ~69–72):

```ts
function resolveEl(name: string): Element | undefined {
  const sel = `[data-embinder-tool="${(window.CSS?.escape ?? ((x: string) => x))(name)}"]`;
  return document.querySelector(sel) ?? undefined;
}
```

with an import at the top of the file (beside the other imports):

```ts
import { resolveAgentTarget } from './resolve-target.js';
```

and delete the local `resolveEl` function entirely.

Add `itemId` to the `active` state. Find its declaration (`let active: { id: string; name: string; gated: boolean } | undefined;`) and change it to:

```ts
  let active: { id: string; name: string; gated: boolean; itemId?: string } | undefined;
```

In `handle`, the `intent` case currently reads:

```ts
        case 'intent':
          if (!m.id || !m.name) break;
          active = { id: m.id, name: m.name, gated: false };
          say(`Agent requesting ${humanize(m.name)}`);
          break;
```

change the assignment to capture the item id from the args preview:

```ts
        case 'intent':
          if (!m.id || !m.name) break;
          active = { id: m.id, name: m.name, gated: false, itemId: (m.argsPreview as { id?: string } | undefined)?.id };
          say(`Agent requesting ${humanize(m.name)}`);
          break;
```

Update `show` to resolve via the helper. Change the signature and the `d.highlight` element line:

```ts
  function show(
    name: string,
    description: string,
    opts: { lock?: boolean; klass?: string; decide?: string; itemId?: string } = {},
  ) {
```

and inside `d.highlight({ ... })` replace `element: resolveEl(name),` with:

```ts
      element: resolveAgentTarget(name, opts.itemId),
```

Finally, pass `active.itemId` at each `show(active.name, ...)` call inside `handle` by adding `itemId: active.itemId` to the existing opts object. The gate/awaiting call becomes:

```ts
            show(
              active.name,
              `<span class="gmc-kicker">Needs approval</span>Allow the agent to run this?` +
                `<div class="gmc-approve-row"><button class="gmc-decide gmc-approve" data-approve="1">Approve</button><button class="gmc-decide gmc-deny" data-approve="0">Deny</button></div>`,
              { lock: true, klass: 'gmc-pending', decide: active.id, itemId: active.itemId },
            );
```

and the four single-line `show(active.name, '<...>', { klass: '...' })` calls (denied, approved, call/running, done) each gain `, itemId: active.itemId` inside their opts object, e.g.:

```ts
              show(active.name, `<span class="gmc-kicker">Blocked</span>Denied by the policy gate.`, { klass: 'gmc-denied', itemId: active.itemId });
```
```ts
              show(active.name, `<span class="gmc-kicker">Approved</span>Running now.`, { klass: 'gmc-done', itemId: active.itemId });
```
```ts
          if (active.gated) show(active.name, `<span class="gmc-kicker">Running</span>Applying the change.`, { klass: 'gmc-done', itemId: active.itemId });
```
```ts
            show(active.name, `<span class="gmc-kicker">Done</span>Change applied.`, { klass: 'gmc-done', itemId: active.itemId });
```

- [ ] **Step 2: Update `ghost-cursor.ts` — import, capture id, thread through `goTarget`**

Add the import beside the existing imports at the top:

```ts
import { resolveAgentTarget } from './resolve-target.js';
```

Delete the local `resolveEl` function (the `function resolveEl(name: string): Element | undefined { ... }` block near the top of the module).

Change `goTarget` to accept and use an item id. It currently reads:

```ts
  function goTarget(name: string) {
    const t = resolveEl(name);
    target = t;
    if (t) {
      const p = pointAt(t);
      glideTo(p.x, p.y);
    }
  }
```

replace with:

```ts
  function goTarget(name: string, itemId?: string) {
    const t = resolveAgentTarget(name, itemId);
    target = t;
    if (t) {
      const p = pointAt(t);
      glideTo(p.x, p.y);
    }
  }
```

Also update the `retrack` scroll/resize follower, which re-resolves the current target — it already holds `target` directly (`const p = pointAt(target)`), so it needs no change.

Add `itemId` to the `active` state. Find `let active: { id: string; name: string } | undefined;` and change to:

```ts
  let active: { id: string; name: string; itemId?: string } | undefined;
```

In `handle`, the `intent` case sets `active` and calls `goTarget(m.name)`:

```ts
        case 'intent':
          if (!m.id || !m.name) break;
          active = { id: m.id, name: m.name };
          cancelIdle();
          stopWander();
          el.classList.remove('is-pending', 'is-denied');
          el.classList.add('is-working');
          goTarget(m.name);
          break;
```

change the assignment and the call:

```ts
        case 'intent':
          if (!m.id || !m.name) break;
          active = { id: m.id, name: m.name, itemId: (m.argsPreview as { id?: string } | undefined)?.id };
          cancelIdle();
          stopWander();
          el.classList.remove('is-pending', 'is-denied');
          el.classList.add('is-working');
          goTarget(m.name, active.itemId);
          break;
```

The other `goTarget(active.name)` calls in the `gate` and `call` cases become `goTarget(active.name, active.itemId)`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @embinder/react`
Expected: exit 0.

- [ ] **Step 4: Full react suite (regression guard — viz is not unit-tested, so confirm nothing else broke)**

Run: `npm test --workspace @embinder/react`
Expected: PASS — all suites, including the new `resolve-target` and `AgentList` tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/spotlight.ts packages/react/src/ghost-cursor.ts
git commit -m "feat(react): per-item spotlight/ghost resolution from the call id"
```

---

## Task 4: Verify whole-package build + typecheck + e2e regression

No new code — the definition-of-done gates for the feature.

**Files:** none.

- [ ] **Step 1: Full react suite**

Run: `npm test --workspace @embinder/react`
Expected: PASS — existing suites + `AgentList` (4) + `resolve-target` (4), 0 failures.

- [ ] **Step 2: Typecheck all workspaces**

Run: `npm run typecheck`
Expected: exit 0 across `@embinder/react` + `@embinder/relay`.

- [ ] **Step 3: e2e regression guard**

Run: `npm run e2e`
Expected: GREEN — "E2E + GATE GREEN" (relay/gate untouched; this must not regress).

- [ ] **Step 4: Commit (if any tracking files updated; otherwise skip)**

```bash
git commit --allow-empty -m "chore: AgentList verification pass (react suite + typecheck + e2e green)"
```

---

## Task 5 (OPTIONAL): Wire AgentList into apps/todo TaskCards

Flagged optional per the spec. Proves the pattern end-to-end and fixes the real per-item spotlight bug (every card currently shares `grabAnchor('toggle_task')`). Only do this task if the executor/user opts in.

**Files:**
- Modify: `apps/todo/src/components/Board.tsx` (or wherever the card list is mapped) to render cards through `<AgentList name="task">`.
- Modify: `apps/todo/src/components/TaskCard.tsx` — remove `grabAnchor('toggle_task')` / `grabAnchor('edit_task')` / `grabAnchor('delete_task')` from the card's controls (the AgentList anchor now lives on the card root).
- Modify: `apps/todo/src/tools.ts` — remove the imperative `toggle_task`, `edit_task`, `delete_task` `useEmbinder` declarations (AgentList registers them now).

**Interfaces:**
- Consumes: `AgentList` from `@embinder/react`.

- [ ] **Step 1: Replace the card `.map()` with AgentList**

In the board/list render, replace the direct `tasks.map((t) => <TaskCard ... />)` with:

```tsx
<AgentList
  name="task"
  items={tasks}
  getId={(t) => t.id}
  describe={(t) => `Task "${t.text}" (${t.done ? 'done' : 'open'}, ${t.priority})`}
  actions={{
    toggle: { description: 'Toggle a task done/undone by id', run: (t) => dispatch({ type: 'TOGGLE_TASK', id: t.id }) },
    edit: {
      description: 'Change a task\'s text',
      input: { text: z.string().describe('New task text') },
      run: (t, a) => dispatch({ type: 'EDIT_TASK', id: t.id, patch: { text: a.text as string } }),
    },
    delete: { description: 'Delete a single task by id', destructive: true, run: (t) => dispatch({ type: 'DELETE_TASK', id: t.id }) },
  }}
  renderItem={(t, anchor) => (
    <div {...anchor} key={t.id}>
      <TaskCard task={t} dispatch={dispatch} />
    </div>
  )}
/>
```

(Adapt the surrounding container/props to the actual file; `z` is imported from `zod`.)

- [ ] **Step 2: Remove the now-duplicate imperative tools from `tools.ts`**

Delete the `useEmbinder({ name: 'toggle_task', ... })`, `useEmbinder({ name: 'edit_task', ... })`, and `useEmbinder({ name: 'delete_task', ... })` blocks (leave a one-line comment noting AgentList now owns them). Remove the matching `grabAnchor('toggle_task'|'edit_task'|'delete_task')` spreads in `TaskCard.tsx`.

- [ ] **Step 3: Build + lint the app**

Run: `npm run build --workspace todo` then `cd apps/todo && npx oxlint`
Expected: build exit 0; lint exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/todo
git commit -m "feat(todo): drive task cards through AgentList (per-item spotlight precision)"
```

---

## Definition of Done

- Tasks 1–4 complete; `AgentList` + `resolve-target` suites pass; per-item resolution wired into both viz files.
- `npm run typecheck` exit 0 across workspaces.
- `npm test --workspace @embinder/react` green.
- `npm run e2e` GREEN (regression: relay/gate untouched).
- Task 5 is optional; if done, todo builds + lints clean.

## Out-of-scope follow-ups (do not build now)

- Applying AgentList to other lists (columns, archive) in the todo app.
- List virtualization / pagination.
- A single polymorphic `action`-enum tool (the spec chose per-action tools).
