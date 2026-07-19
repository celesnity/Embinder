# AgentForm — one structured tool that fills + submits a form

**Date:** 2026-07-19
**Package:** `@embinder/react`
**Status:** Design approved, pending spec review

## Problem

Today a multi-field form (login, create-task, checkout) is expressed to the agent as N separate
input tools plus a submit button — or, more realistically, it isn't agent-drivable at all. There
is no way to say "here is a form; fill these fields and submit as one call." Forms are the most
common real-app interaction after buttons and lists, so this is a large gap.

## Goals

- A declarative `<AgentForm>` that registers **one** structured tool per form: `submit_${name}`.
- Stay on-thesis (fewer tools): one tool replaces N field tools + a submit button.
- **Drive the real DOM** (agent action == user action): the tool fills the actual input elements
  via the existing native-setter dispatch, so the developer's `onChange` fires and React state
  updates, then triggers a native submit so the developer's own submit logic runs.
- Reuse the existing pipeline (`useEmbinder` → relay → gate → spotlight) and `dispatch.ts`; no
  relay/wire changes.

## Non-goals (YAGNI)

- Multi-step wizards.
- File inputs.
- Client-side Zod validation enforcement (the schema describes the form to the agent; the app's
  `onSubmit` validates).
- Per-field agent tools (the whole point is one structured submit).
- Redacting/hiding submitted values from the agent or the audit log (see "Secrets" — documented
  caveat, deferred).
- A live context pointer of field values (the input schema is the agent's understanding).

## Architecture

### Component API

```tsx
<AgentForm
  name="login"                         // registers the tool `submit_login`
  description="Log in with email and password"
  fields={{ email: z.string().email(), password: z.string() }}  // Zod raw shape
  onSubmit={(values) => doLogin(values)}   // receives the collected values object
  destructive={false}                  // optional → routes submit through the human gate
  className="login-form"               // remaining native <form> props pass through
>
  <input name="email" value={...} onChange={...} />
  <input name="password" type="password" ... />
  <button type="submit">Log in</button>
</AgentForm>
```

`AgentForm` **renders the real `<form>` element** wrapping its children (the developer must NOT
nest their own `<form>`). It owns the form's native `onSubmit`, so both a human clicking the
submit button and the agent's tool call travel the identical path.

### Types

```ts
interface AgentFormProps extends Omit<React.ComponentPropsWithoutRef<'form'>, 'onSubmit'> {
  /** Registers the tool `submit_${name}`; also the spotlight anchor. */
  name: string;
  description: string;
  /** Zod raw shape describing the fields the agent supplies. Keys map to input `name=`. */
  fields: Record<string, ZodTypeAny>;
  /** Called with the collected field values after submit (agent- or human-triggered). */
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  destructive?: boolean;
  title?: string;
}

function AgentForm(props: AgentFormProps): ReactElement;
```

### Behavior — fill by element type, then native submit

The registered tool `submit_${name}` has input schema = `fields`. Its handler:

1. For each **provided** key in the call args, find `form.elements.namedItem(key)` and fill by
   element type, reusing `dispatch.ts`:
   - `<input type=text|email|password|...>` / `<textarea>` → `fireInputValue(el, String(value))`
   - `<input type=checkbox>` → `fireCheckbox(el, Boolean(value))`
   - `<select>` → `fireSelectValue(el, String(value))`
   - A provided key whose element is missing (or an unhandled element type) → skip it and
     `console.warn` (dev signal); do not throw.
2. `form.requestSubmit()` — fires the native submit event.
3. The form's native `onSubmit` handler (installed by AgentForm) calls `event.preventDefault()`,
   collects the current values via `collectValues(form, fields)`, and calls the developer's
   `onSubmit(values)`.
4. The tool returns `{ ok: true, submitted: values }`.

`collectValues(form, fields)` reads each declared field key from `form.elements.namedItem(key)`
and returns `{ [key]: value }` where value is `checked` for checkboxes, `.value` otherwise
(string). Keys with no matching element are omitted.

Because the human submit button routes through the same native `onSubmit`, a human filling the
form and clicking submit produces the same `onSubmit(values)` call — one code path.

### What it registers

- One tool `submit_${name}` (input schema = `fields`, `destructiveHint` when `destructive`),
  registered via `useEmbinder`. The returned `data-embinder-tool` bind is spread onto the
  `<form>` so the spotlight/ghost anchor the form when the agent submits it.
- No context pointer.

Optional Zod fields (`z.string().optional()`) are non-required in the tool schema (handled by the
existing `useEmbinder` → `zodToJsonSchema`, which reads `ZodOptional`). The agent may submit any
subset; unprovided declared fields keep their current DOM value and are included in the collected
values as-is.

## Error handling / edge cases

- **No `EmbinderProvider` above the component:** `useEmbinder` already warns; unchanged.
- **`form` ref null at call time** (unmounted mid-call): guard in the handler — return
  `{ ok: false, error: 'form_unmounted' }`, do not throw.
- **Provided key with no matching `name` in the form:** skip + `console.warn`; still submit the
  rest.
- **Provided value type mismatch** (e.g. a number for a text field): coerced via `String(value)`
  / `Boolean(value)` in the fill step; no validation error.
- **`onSubmit` throws:** surfaced through the existing provider `.catch` as the tool's error
  result.
- **Duplicate field `name`s in the DOM:** `form.elements.namedItem` returns the first (or a
  RadioNodeList for radios) — document that field `name`s should be unique within the form; radio
  groups are out of scope for v1 (use `AgentRadioGroup` separately).

## Secrets (documented caveat, deferred)

Submitted values are supplied by the agent in the tool call, so they are inherently known to the
agent/LLM and audited by the gate to `audit.jsonl` like any tool call. AgentForm does not redact
them. **Do not use `AgentForm` for secrets you must hide from the agent.** Real redaction is a
cross-cutting relay/audit feature for a later iteration.

## File layout

```
packages/react/src/components/
  AgentForm.tsx        // component + AgentFormProps + collectValues/fill helpers
  AgentForm.test.tsx
  index.ts             // barrel: export AgentForm + AgentFormProps
packages/react/src/
  index.ts             // export AgentForm + AgentFormProps
```

Reuses `packages/react/src/components/dispatch.ts` (`fireInputValue`, `fireCheckbox`,
`fireSelectValue`) and `useEmbinder`.

## Testing / verification

- **Unit (vitest, jsdom)** in `AgentForm.test.tsx`:
  - Registers `submit_login` with `inputSchema.properties.email`/`.password` (types) and, with
    `destructive`, `annotations.destructiveHint === true`.
  - Calling `submit_login` with `{ email, password }` fills the real `<input>` elements (assert
    their `.value`) AND fires the developer's field `onChange` (spy), then calls the developer's
    `onSubmit` with the collected `{ email, password }` (spy), and the tool result is
    `{ ok: true, submitted: { ... } }`.
  - A checkbox field: calling with `{ remember: true }` checks the box and the collected values
    include `remember: true`.
  - A provided key with no matching `name` warns (spy on `console.warn`) and is skipped; the rest
    still submit.
  - The `<form>` carries `data-embinder-tool="submit_login"`.
- **`npm run typecheck`** — exit 0 across workspaces.
- **`npm test --workspace @embinder/react`** — full suite green (existing + new).

## Optional follow-up (flagged, not in the core plan)

- A demo in `apps/todo` (e.g. an agent-submittable "add task" form or a settings form) to prove
  the pattern end-to-end in the reference app.
