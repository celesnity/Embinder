# Agent Components — design spec

**Date:** 2026-07-18
**Package:** `@embinder/react`
**Status:** Design approved, pending spec review

## Problem

Today the app-side SDK exposes one primitive: the `useEmbinder(descriptor)` hook. A
developer drops it on a component, writes an explicit `handler` / `context` selector, and
spreads the returned `data-embinder-tool` attribute onto an element. This is powerful but
verbose: every agent-operable element needs a hand-written descriptor and handler.

We want a thinner, declarative surface: **agent-aware wrapper components** that override the
default HTML elements. A developer writes `<AgentButton name="..." description="...">` instead
of a native `<button>`, and the element becomes visible + operable by the agent with **no
hand-written handler**. The agent drives the element by dispatching native DOM events, so the
agent's action path is identical to a real user's.

## Goals

- A fixed set of 8 declarative components that wrap native elements and auto-register MCP tools.
- **Zero hand-written handlers**: behavior is inferred from the DOM (auto-infer).
- `description` is prompt context AND the component auto-pushes **live runtime state** (value,
  checked, disabled, options...) so the agent reads current state, reusing the existing
  `context()` debounce mechanism.
- Reuse ALL existing infrastructure unchanged: `useEmbinder` → relay → policy gate → spotlight.
- No changes to `@embinder/relay`, the gate, or the wire protocol.

## Non-goals (YAGNI)

- A generic `agent(Component)` factory in the public API (internal factory only; fixed exports).
- The agent reading real source code around an element.
- Component types beyond the initial 8 (e.g. sliders, date pickers, file inputs) — the internal
  factory makes these cheap to add later, but they are out of scope now.
- Any change to relay / gate / spotlight / audit.

## Architecture

### Internal factory

A single internal helper builds every agent component:

```ts
createAgentElement(tag, adapter)
```

where `adapter` describes how that element type maps to an MCP tool:

```ts
interface AgentAdapter<Ref extends HTMLElement, Args> {
  // Zod raw shape for the tool input; omitted => no-arg action.
  inputSchema?: (props) => Record<string, ZodTypeAny> | undefined;
  // Agent-callable behavior: dispatch native events on the ref so the developer's
  // own onClick/onChange fire naturally.
  execute?: (ref: Ref, args: Args) => void;
  // Live read-only state, sampled after each commit and pushed via context().
  readState: (ref: Ref) => unknown;
  // Whether this element type is context-only (no callable tool). e.g. AgentDiv.
  contextOnly?: boolean;
}
```

`createAgentElement` returns a React component that:

1. Renders the real native element with all native props spread through, plus a `ref`.
2. Calls `useEmbinder` with:
   - `name` / `description` / `title` / `destructive` from props.
   - `input` = `adapter.inputSchema(props)`.
   - `handler` = `(args) => adapter.execute(ref.current, args)` (omitted when `contextOnly`).
   - `context` = props `context` override, else `() => adapter.readState(ref.current)`.
3. Spreads the `data-embinder-tool` attribute returned by `useEmbinder` onto the element (so
   the spotlight can highlight it).

This keeps the entire existing pipeline intact — the wrapper is pure sugar over `useEmbinder`.

### Driving the DOM (auto-infer)

The agent's `execute` never mutates app state directly; it dispatches the native event a user
would:

- **Click-like** (button, link, radio option, toggle): `ref.click()`.
- **Value-like** (input, textarea, select, checkbox): set the value/checked via the native
  property setter, then dispatch an `input` + `change` event so React's synthetic `onChange`
  fires. Use the standard controlled-input technique (`Object.getOwnPropertyDescriptor` on the
  prototype `value`/`checked` setter) so controlled React components update correctly.

This means the developer's own `onClick` / `onChange` handlers run unchanged — agent action ==
user action.

## Component set (initial 8)

| Component | Element | Tool input | execute | Live state |
|---|---|---|---|---|
| `AgentButton` | `<button>` | none | `ref.click()` | `{ disabled, label }` |
| `AgentInput` | `<input>` / `<textarea>` | `{ value: string }` | set value + fire change | `{ value, placeholder, disabled }` |
| `AgentSelect` | `<select>` | `{ value: string }` (from options) | set value + fire change | `{ options, value, disabled }` |
| `AgentDiv` | `<div>` | — (context-only) | — | text content or `context()` |
| `AgentCheckbox` | `<input type=checkbox>` | `{ checked: boolean }` | set checked + fire change | `{ checked, disabled }` |
| `AgentRadioGroup` | `<div role=radiogroup>` wrapping radios | `{ value: string }` (from options) | check matching radio + fire change | `{ options, value, disabled }` |
| `AgentToggle` | `<button role=switch>` | `{ on: boolean }` | set aria-checked + click | `{ on, disabled }` |
| `AgentLink` | `<a>` | none | `ref.click()` | `{ href, text }` |

**AgentRadioGroup** is the one grouping component: it takes an `options` prop (or reads the
radios it wraps) and registers a single `set value = X` tool, per the group-level decision.
Individual radios stay plain elements.

### Shared props (all Agent* components)

- `name: string` — required, unique per mounted screen (matches `useEmbinder`'s last-mount-wins
  rule; duplicate names warn/error exactly as today).
- `description: string` — prompt context surfaced via `tools/list`.
- `destructive?: boolean` — sets `destructiveHint` (policy file still authoritative).
- `context?: () => unknown` — optional override of the auto `readState` selector.
- `title?: string`.
- All remaining native props (`onClick`, `onChange`, `className`, `value`, `disabled`, ...) are
  spread onto the underlying element.

## File layout

```
packages/react/src/components/
  createAgentElement.tsx     // internal factory
  AgentButton.tsx
  AgentInput.tsx
  AgentSelect.tsx
  AgentDiv.tsx
  AgentCheckbox.tsx
  AgentRadioGroup.tsx
  AgentToggle.tsx
  AgentLink.tsx
  index.ts                   // barrel
  dispatch.ts                // native value/checked setter + event dispatch helpers
```

Public exports added to `packages/react/src/index.ts` (the 8 components + their prop types).
Nothing else in the package changes; `useEmbinder` stays as the low-level escape hatch.

## Error handling / edge cases

- **No provider above component**: `useEmbinder` already warns; unchanged.
- **Duplicate `name`**: existing mount-count error path applies.
- **`ref.current` null at execute time** (element unmounted mid-call): guard in `execute`, return
  a benign no-op / thrown error surfaced through the tool result.
- **Controlled vs uncontrolled inputs**: the native-setter dispatch technique works for both.
- **Live state > 16KB**: existing `CONTEXT_MAX_BYTES` truncation in `useEmbinder` applies.
- **AgentSelect / AgentRadioGroup value not in options**: `execute` no-ops on unknown value and
  the tool result reports it (do not silently set an invalid value).

## Testing / verification

- **Unit (vitest, jsdom)** per component: render, assert the registered tool descriptor
  (name/description/inputSchema/destructiveHint), invoke the handler, assert the native event
  fired and the developer's `onClick`/`onChange` ran, and assert `readState` reflects live props.
- **`npm run typecheck`** — exit 0 across workspaces (definition-of-done gate).
- **`npm run e2e`** — must stay GREEN (no relay/gate changes; regression guard).
- Optionally extend the reference `apps/todo` to use one agent component and confirm the existing
  round-trip still passes; not required for the first cut.

## Out-of-scope follow-ups (noted, not built)

- Additional element types via the same factory (slider, date, file, textarea-as-distinct).
- Wiring an agent component into `apps/todo` for a live-browser demo (belongs with F-D8).
