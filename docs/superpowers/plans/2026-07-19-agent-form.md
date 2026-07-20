# AgentForm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `AgentForm` to `@embinder/react`: one structured `submit_${name}` tool fills a real form and submits it through exactly the same callback path as a human submission.

**Architecture:** `AgentForm` owns a native `<form>`, registers one `useEmbinder` handler, and uses the existing native-dispatch helpers for real DOM mutations. The native submit event creates one promise for the developer callback; the agent handler triggers `requestSubmit()` and awaits that promise, so success, rejection, and human interaction all share one submit implementation. Relay, policy, wire protocol, and the Todo reference app remain untouched.

**Tech Stack:** TypeScript ESM, React 18/19, Zod raw shapes, Vitest, jsdom, Testing Library.

## Global Constraints

- Implement only under `packages/react/src/`; do not modify relay, gate, policy, protocol, or `apps/todo`.
- Keep ESM import specifiers with `.js` extensions.
- Register exclusively with `useEmbinder`; do not call `getModelContext()` or `registerTool()` directly.
- The form named `name` registers exactly one `submit_${name}` tool. Its raw Zod input is `fields`; optional Zod fields remain optional via `useEmbinder`.
- Render the real `<form>` and spread the returned `data-embinder-tool` bind on it. Consumers must not nest another form.
- For provided inputs, use `form.elements.namedItem(key)`: text-like `<input>` and `<textarea>` call `fireInputValue`, checkbox calls `fireCheckbox`, and `<select>` calls `fireSelectValue`. Missing, `RadioNodeList`, or unsupported controls warn and do not block submission.
- Collect every declared, matching field at submission time: checkbox is `checked`; text/select/textarea is `value`; unmatched and radio controls are omitted. There is no client-side Zod validation or context pointer.
- The agent handler returns `{ ok: false, error: 'form_unmounted' }` if its ref is null; otherwise it resolves to `{ ok: true, submitted: values }` only after the developer callback completes. A developer callback rejection must reach the provider's existing error result path.
- Do not use `AgentForm` for secrets that must be hidden from the agent or `audit.jsonl`; the agent-supplied values are inherently visible and audited. Redaction is out of scope.
- Repository policy currently lists F-D8 as the next unfinished feature. Before implementing this new work, either finish F-D8 or explicitly add/prioritize an AgentForm feature in `feature_list.json`; then run `./init.ps1` successfully and mark only that feature `in_progress`.
- Do not commit unless the user asks. Record real verification evidence and update `claude-progress.md` only during implementation.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `packages/react/src/components/AgentForm.tsx` | Create | Form component, controlled DOM filling, collection, native submit bridge. |
| `packages/react/src/components/AgentForm.test.tsx` | Create | SDK registration and behavior tests through the fake relay. |
| `packages/react/src/components/index.ts` | Modify | Component-barrel exports. |
| `packages/react/src/index.ts` | Modify | Public package exports. |

Existing dependencies: `packages/react/src/use-embinder.ts` supplies `useEmbinder`; `packages/react/src/components/dispatch.ts` supplies `fireInputValue`, `fireCheckbox`, and `fireSelectValue`; `packages/react/src/components/agent-test-harness.tsx` provides `setupFakeRelay`, `loadSdk`, `socket`, and `callTool`.

---

### Task 1: Specify AgentForm through failing relay-backed tests

**Files:**

- Create: `packages/react/src/components/AgentForm.test.tsx`
- Read: `packages/react/src/components/agent-test-harness.tsx`

**Interfaces:**

- Consumes: `AgentForm` exported by `@embinder/react`; fake relay registration message `{ type: 'register', tool }`; tool invocation helper `callTool(ws, name, args)`.
- Produces: executable proof of registration, native controlled-input updates, native human submit, checkbox support, missing-field warnings, and rejected submission propagation.

- [ ] **Step 1: Add the registration test.**

```tsx
it('registers one submit tool with the raw field schema, destructive hint, and form anchor', async () => {
  const { EmbinderProvider, AgentForm } = await loadSdk();
  const { getByTestId } = render(
    <EmbinderProvider chat={false}>
      <AgentForm name="login" description="Log in" destructive data-testid="login-form"
        fields={{ email: z.string().email(), password: z.string() }} onSubmit={() => {}}>
        <input name="email" /><input name="password" type="password" />
      </AgentForm>
    </EmbinderProvider>,
  );
  expect(getByTestId('login-form')).toHaveAttribute('data-embinder-tool', 'submit_login');
  const ws = await socket();
  await waitFor(() => expect(ws.ofType('register')).toHaveLength(1));
  const tool = (ws.ofType('register')[0] as any).tool;
  expect(tool).toMatchObject({ name: 'submit_login', description: 'Log in', annotations: { destructiveHint: true } });
  expect(tool.inputSchema.properties).toMatchObject({ email: { type: 'string' }, password: { type: 'string' } });
  expect(tool.inputSchema.required).toEqual(['email', 'password']);
});
```

- [ ] **Step 2: Add one controlled-form tool-path test.** Mount email/password/checkbox state with React `useState`; call `submit_login` with all fields; assert email `onChange`, DOM `value`/`checked`, developer `onSubmit`, and the fake-relay result all equal `{ email: 'a@b.co', password: 'secret', remember: true }`.

```tsx
callTool(ws, 'submit_login', { email: 'a@b.co', password: 'secret', remember: true });
await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret', remember: true }));
expect(onEmailChange).toHaveBeenCalledWith('a@b.co');
expect(email.value).toBe('a@b.co');
expect(remember.checked).toBe(true);
await waitFor(() => expect(ws.ofType('result')[0]).toMatchObject({
  result: { ok: true, submitted: { email: 'a@b.co', password: 'secret', remember: true } },
}));
```

- [ ] **Step 3: Add three isolated boundary tests.** Each test renders its own provider/form, obtains a fresh fake socket, and makes exactly one tool call so result indexes are deterministic.

```tsx
// A declared/provided field with no DOM control warns, omits it from collected values, and submits.
const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
callTool(ws, 'submit_login', { email: 'x@y.co', ghost: 'skip' });
await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ email: 'x@y.co' }));
expect(warn).toHaveBeenCalledWith(expect.stringContaining('ghost'));

// A human click travels through the same form handler; render this in a separate test.
fireEvent.click(getByRole('button', { name: 'Submit' }));
expect(onSubmit).toHaveBeenCalledWith({ email: 'human@y.co' });

// In another fresh render, a rejected developer submit becomes the provider error result,
// never a false ok response.
callTool(ws, 'submit_rejecting', { email: 'x@y.co' });
await waitFor(() => expect(ws.ofType('result')[0]).toMatchObject({ error: 'Error: submit failed' }));
```

- [ ] **Step 4: Run the focused test before implementation.**

Run: `npm test --workspace @embinder/react -- src/components/AgentForm.test.tsx`
Expected: FAIL because `AgentForm` is not exported.

### Task 2: Implement the one-tool real-form bridge and exports

**Files:**

- Create: `packages/react/src/components/AgentForm.tsx`
- Modify: `packages/react/src/components/index.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/src/components/AgentForm.test.tsx`

**Interfaces:**

- Consumes: `useEmbinder({ name, title, description, input, destructive, handler })`, `fireInputValue`, `fireCheckbox`, and `fireSelectValue`.
- Produces: `AgentFormProps` and `AgentForm(props): ReactElement`; package and component-barrel exports for both.

- [ ] **Step 1: Create the component with the exact public type and DOM helpers.**

```tsx
import { useRef, type ComponentPropsWithoutRef, type FormEvent, type ReactElement } from 'react';
import type { ZodTypeAny } from 'zod';
import { useEmbinder } from '../use-embinder.js';
import { fireCheckbox, fireInputValue, fireSelectValue } from './dispatch.js';

export interface AgentFormProps extends Omit<ComponentPropsWithoutRef<'form'>, 'onSubmit'> {
  name: string;
  description: string;
  fields: Record<string, ZodTypeAny>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  destructive?: boolean;
  title?: string;
}

function firstControl(item: Element | RadioNodeList | null): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement || item instanceof HTMLSelectElement ? item : null;
}

function fillControl(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: unknown): boolean {
  if (control instanceof HTMLInputElement && control.type === 'checkbox') { fireCheckbox(control, Boolean(value)); return true; }
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) { fireInputValue(control, String(value)); return true; }
  if (control instanceof HTMLSelectElement) { fireSelectValue(control, String(value)); return true; }
  return false;
}

function collectValues(form: HTMLFormElement, fields: Record<string, ZodTypeAny>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(fields).flatMap((key) => {
    const control = firstControl(form.elements.namedItem(key));
    if (!control) return [];
    return [[key, control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value]];
  }));
}
```

- [ ] **Step 2: Implement the native-submit promise bridge.** The native event must set `submitPromiseRef.current` synchronously, prevent default navigation, then call the developer callback in a promise chain. The tool invokes native submission, captures that promise, and awaits it; this preserves the current provider `.catch` behavior.

```tsx
const formRef = useRef<HTMLFormElement>(null);
const submitPromiseRef = useRef<Promise<void> | null>(null);
const handleNativeSubmit = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const values = collectValues(event.currentTarget, fields);
  const pending = Promise.resolve().then(() => onSubmit(values));
  submitPromiseRef.current = pending;
  void pending;
};

const bind = useEmbinder({
  name: `submit_${name}`, title, description, destructive, input: fields,
  handler: (async (args: Record<string, unknown>) => {
    const form = formRef.current;
    if (!form) return { ok: false, error: 'form_unmounted' };
    for (const [key, value] of Object.entries(args)) {
      const control = firstControl(form.elements.namedItem(key));
      if (!control || !fillControl(control, value)) console.warn(`[embinder] AgentForm "${name}": no fillable field named "${key}"`);
    }
    submitPromiseRef.current = null;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const pending = submitPromiseRef.current;
    if (!pending) throw new Error(`AgentForm "${name}" did not receive a submit event`);
    await pending;
    return { ok: true, submitted: collectValues(form, fields) };
  }) as (args: never) => Promise<unknown>,
});
```

- [ ] **Step 3: Render the native form and add exports.** Place the caller’s other form props before `...bind`, so the component’s anchor cannot be overwritten. Do not forward the developer callback as a DOM `onSubmit`.

```tsx
return <form {...formProps} ref={formRef} onSubmit={handleNativeSubmit} {...bind}>{children}</form>;
```

```ts
// packages/react/src/index.ts
export { AgentForm } from './components/AgentForm.js';
export type { AgentFormProps } from './components/AgentForm.js';
```

```ts
// packages/react/src/components/index.ts
export { AgentForm } from './AgentForm.js';
export type { AgentFormProps } from './AgentForm.js';
```

- [ ] **Step 4: Run the focused test and typecheck.**

Run: `npm test --workspace @embinder/react -- src/components/AgentForm.test.tsx`
Expected: PASS; registration, input/checkbox dispatch, shared human submit, warning, and rejected callback behavior pass.

Run: `npm run typecheck --workspace @embinder/react`
Expected: exit 0.

### Task 3: Verify the package and record evidence

**Files:**

- Modify during implementation only: `feature_list.json` and `claude-progress.md`, following the repository operating rules and only with real command output.

**Interfaces:**

- Consumes: completed AgentForm behavior and the repository verification commands.
- Produces: current-host evidence and accurate feature/session status.

- [ ] **Step 1: Run the full React suite.**

Run: `npm test --workspace @embinder/react`
Expected: all existing component, dispatch, hook, and ChatBubble tests plus AgentForm pass with zero failures.

- [ ] **Step 2: Run workspace typecheck.**

Run: `npm run typecheck`
Expected: exit 0 across all workspaces.

- [ ] **Step 3: Run the wire regression guard.**

Run: `npm run e2e`
Expected: exit 0 and `E2E + GATE GREEN`.

- [ ] **Step 4: Record only observed results.** Update the selected feature’s `status` to `passing` and put each exact command plus actual output in its `evidence`; add a dated `claude-progress.md` session record. If any command fails, leave the feature `in_progress` and record the failure and remaining verification instead. Do not commit unless the user separately requests it.

---

## Plan self-review

- **Spec coverage:** Task 1 covers registration, schema, destructive annotation, DOM anchor, input/checkbox updates, warning-and-submit behavior, human path, and rejection propagation. Task 2 implements the corresponding component API, fill rules, collection rules, native submit, the defensive null-ref guard, and public exports. A mounted component cannot receive a post-unmount relay call because `useEmbinder` unregisters the tool on cleanup.
- **Intentional scope:** No Todo demo, context pointer, per-field tools, radio support, file inputs, client Zod validation, or audit redaction is introduced.
- **Type consistency:** `fields` is a `Record<string, ZodTypeAny>` throughout; handler returns the specified success/unmounted result; `onSubmit` always receives `Record<string, unknown>`.
- **Repository constraints:** execution is gated on the feature backlog and green baseline; the plan does not authorize commits.

## Definition of Done

- `AgentForm` is publicly exported and has one `submit_${name}` structured tool.
- Agent and human submissions use the same native form handler; failures reach the provider error path.
- Focused and full React tests, root typecheck, and e2e pass on the implementation host, with exact evidence recorded.
