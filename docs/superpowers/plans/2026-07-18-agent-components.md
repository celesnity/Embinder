# Agent Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 declarative, agent-aware wrapper components to `@embinder/react` that override native HTML elements and auto-register MCP tools with no hand-written handlers.

**Architecture:** A single internal factory `createAgentElement(adapter)` builds every component. Each component renders the real native element (all native props spread through) with an internal ref, calls the existing `useEmbinder` hook to register a tool + push live state, and drives the DOM by dispatching native events on the ref (so the developer's own `onClick`/`onChange` fire — agent action == user action). Nothing in `@embinder/relay`, the gate, or the wire protocol changes.

**Tech Stack:** TypeScript (ESM), React 19, Zod raw shapes, Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Package scope:** all changes live in `packages/react/src/`. Do NOT modify `@embinder/relay`, the gate, or wire protocol.
- **Module style:** ESM; intra-package imports use the `.js` extension (e.g. `import { useEmbinder } from '../use-embinder.js'`), matching the existing codebase.
- **Reuse `useEmbinder`:** components MUST register through the existing `useEmbinder` hook — never call `getModelContext()`/`registerTool` directly.
- **Input schemas:** Zod raw shapes (`{ value: z.string() }`), matching `EmbinderDescriptor.input`.
- **`name` prop:** required, unique per mounted screen (duplicate-name warning is already handled inside `useEmbinder`).
- **Typecheck gate:** `npm run typecheck` must be exit 0 across workspaces before a feature is done.
- **Regression gate:** `npm run e2e` must stay GREEN (no relay/gate changes).
- **Test command (single file):** `npm test --workspace @embinder/react -- src/components/<FILE>.test.tsx`

---

## Reference: existing interfaces this plan consumes

From `packages/react/src/use-embinder.ts` (do NOT change):

```ts
export interface EmbinderBind { 'data-embinder-tool': string; }
export interface EmbinderDescriptor {
  name: string;
  description: string;
  input?: Record<string, ZodTypeAny>;
  handler?: (args: never) => unknown | Promise<unknown>;
  context?: () => unknown;
  destructive?: boolean;
  title?: string;
}
export function useEmbinder(descriptor: EmbinderDescriptor): EmbinderBind;
```

Register/context wire shape asserted in tests (from `provider.tsx`):
- `register` message: `{ type: 'register', tool: { name, title, description, inputSchema, annotations } }`
- `context` message: `{ type: 'context', name, state }`
- incoming `call`: `{ type: 'call', id, name, args }` → shim calls `descriptor.execute(args)` → replies `{ type: 'result', id, result }`
- context-only pointer (no handler) sets `annotations.embinderContextOnly = true`.

---

## File Structure

```
packages/react/src/components/
  dispatch.ts                 // native value/checked setters + DOM event dispatch
  dispatch.test.ts            // unit tests for dispatch helpers
  createAgentElement.tsx      // internal factory + mergeRefs + AgentAdapter type + shared props
  agent-test-harness.tsx      // shared FakeWebSocket + setup helpers for component tests
  AgentButton.tsx
  AgentButton.test.tsx
  AgentInput.tsx
  AgentInput.test.tsx
  AgentSelect.tsx
  AgentSelect.test.tsx
  AgentDiv.tsx
  AgentDiv.test.tsx
  AgentCheckbox.tsx
  AgentCheckbox.test.tsx
  AgentRadioGroup.tsx
  AgentRadioGroup.test.tsx
  AgentToggle.tsx
  AgentToggle.test.tsx
  AgentLink.tsx
  AgentLink.test.tsx
  index.ts                    // barrel re-export of the 8 components + prop types
```

Public exports appended to `packages/react/src/index.ts`. `useEmbinder` remains the low-level escape hatch.

---

## Task 1: DOM dispatch helpers

**Files:**
- Create: `packages/react/src/components/dispatch.ts`
- Test: `packages/react/src/components/dispatch.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fireInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void`
  - `fireSelectValue(el: HTMLSelectElement, value: string): void`
  - `fireCheckbox(el: HTMLInputElement, checked: boolean): void`
  - `clickIfState(el: HTMLElement, desired: boolean, read: (el: HTMLElement) => boolean): void`

**Why these primitives:** React tracks controlled `value`/`checked` internally, so assigning `el.value` directly is swallowed. Calling the prototype's native setter bypasses that tracker; dispatching a bubbling `input`/`change` event then triggers React's synthetic `onChange`. For checkbox/radio/toggle, React's `onChange` maps to the DOM `click` event, so we click only when the current state differs from the desired one.

- [ ] **Step 1: Write the failing test**

```ts
// packages/react/src/components/dispatch.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fireInputValue, fireSelectValue, fireCheckbox, clickIfState } from './dispatch.js';

describe('dispatch helpers', () => {
  it('fireInputValue sets value and dispatches a bubbling input event', () => {
    const el = document.createElement('input');
    document.body.appendChild(el);
    const onInput = vi.fn();
    el.addEventListener('input', (e) => onInput((e as Event).bubbles));
    fireInputValue(el, 'milk');
    expect(el.value).toBe('milk');
    expect(onInput).toHaveBeenCalledWith(true);
    el.remove();
  });

  it('fireSelectValue sets value and dispatches a change event', () => {
    const el = document.createElement('select');
    for (const v of ['a', 'b']) {
      const o = document.createElement('option');
      o.value = v;
      el.appendChild(o);
    }
    document.body.appendChild(el);
    const onChange = vi.fn();
    el.addEventListener('change', () => onChange(el.value));
    fireSelectValue(el, 'b');
    expect(el.value).toBe('b');
    expect(onChange).toHaveBeenCalledWith('b');
    el.remove();
  });

  it('fireCheckbox clicks only when the desired state differs', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    document.body.appendChild(el);
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    fireCheckbox(el, true);          // was false -> clicks
    expect(el.checked).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireCheckbox(el, true);          // already true -> no click
    expect(onClick).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it('clickIfState clicks only when read(el) !== desired', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-checked', 'false');
    document.body.appendChild(el);
    const onClick = vi.fn(() => {
      const now = el.getAttribute('aria-checked') === 'true';
      el.setAttribute('aria-checked', String(!now));
    });
    el.addEventListener('click', onClick);
    const read = (e: HTMLElement) => e.getAttribute('aria-checked') === 'true';
    clickIfState(el, true, read);    // false -> clicks
    expect(onClick).toHaveBeenCalledTimes(1);
    clickIfState(el, true, read);    // already true -> no click
    expect(onClick).toHaveBeenCalledTimes(1);
    el.remove();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/dispatch.test.ts`
Expected: FAIL — cannot resolve `./dispatch.js` / helpers not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/react/src/components/dispatch.ts
// Drive real DOM controls the way a user would, so the developer's own React
// onChange/onClick handlers fire. React tracks controlled value/checked internally;
// we bypass that tracker with the prototype's native setter, then dispatch the event
// React actually listens to (input/change for value, click for checkable controls).

function nativeSet(el: HTMLElement, prop: 'value' | 'checked', value: unknown): void {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, prop)?.set?.call(el, value);
}

export function fireInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  nativeSet(el, 'value', value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function fireSelectValue(el: HTMLSelectElement, value: string): void {
  nativeSet(el, 'value', value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function fireCheckbox(el: HTMLInputElement, checked: boolean): void {
  if (el.checked !== checked) el.click();
}

export function clickIfState(
  el: HTMLElement,
  desired: boolean,
  read: (el: HTMLElement) => boolean,
): void {
  if (read(el) !== desired) el.click();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/dispatch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/components/dispatch.ts packages/react/src/components/dispatch.test.ts
git commit -m "feat(react): native DOM dispatch helpers for agent components"
```

---

## Task 2: Test harness + `createAgentElement` factory + AgentButton

This task builds the factory and its first consumer together, because the factory can only be tested through a concrete component. AgentButton is the simplest (no-arg, click).

**Files:**
- Create: `packages/react/src/components/agent-test-harness.tsx`
- Create: `packages/react/src/components/createAgentElement.tsx`
- Create: `packages/react/src/components/AgentButton.tsx`
- Test: `packages/react/src/components/AgentButton.test.tsx`

**Interfaces:**
- Consumes: `useEmbinder`, `EmbinderBind` from `../use-embinder.js`; `EmbinderProvider` from `../provider.js` (via index in tests).
- Produces:
  - `interface AgentSharedProps { name: string; description: string; destructive?: boolean; title?: string; context?: () => unknown; }`
  - `type AgentTag = 'button' | 'input' | 'textarea' | 'select' | 'div' | 'a';`
  - `interface AgentAdapter<T extends AgentTag, E extends HTMLElement, A> { tag: T; fixedProps?: Record<string, unknown>; input?: Record<string, ZodTypeAny>; contextOnly?: boolean; execute?: (el: E, args: A) => void; readState: (el: E) => unknown; }`
  - `createAgentElement<T extends AgentTag, E extends HTMLElement, A>(adapter: AgentAdapter<T, E, A>): React.ForwardRefExoticComponent<AgentSharedProps & React.ComponentPropsWithoutRef<T> & React.RefAttributes<E>>` — the factory is generic over the concrete tag `T` so the returned component keeps element-specific props (e.g. `placeholder`, `href`, `checked`). Each component passes explicit generics: `createAgentElement<'button', HTMLButtonElement, void>({ tag: 'button', ... })`.
  - `AgentButton` component; `type AgentButtonProps = AgentSharedProps & React.ComponentPropsWithoutRef<'button'>`.
  - Test-harness exports: `class FakeWebSocket`, `setupFakeRelay(): void`, `loadSdk()`, `socket(): Promise<FakeWebSocket>`, `callTool(ws, name, args?)`.

- [ ] **Step 1: Write the shared test harness (no test of its own)**

```tsx
// packages/react/src/components/agent-test-harness.tsx
// Shared fake relay socket + setup for agent-component tests. Mirrors the harness
// inlined in ../use-embinder.test.tsx so each component test stays small.
import { beforeEach, afterEach, expect, vi } from 'vitest';
import { waitFor, cleanup } from '@testing-library/react';

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Set<(ev: unknown) => void>>();
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }
  emit(type: string, ev: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  get messages(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s));
  }
  ofType(type: string) {
    return this.messages.filter((m) => m.type === type);
  }
}

export function setupFakeRelay(): void {
  beforeEach(() => {
    vi.resetModules();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ token: 'test-token' }) })));
    delete (document as { modelContext?: unknown }).modelContext;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
}

export async function loadSdk() {
  return await import('../index.js');
}

export async function socket(): Promise<FakeWebSocket> {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  const ws = FakeWebSocket.instances[0];
  ws.open();
  return ws;
}

export function callTool(ws: FakeWebSocket, name: string, args: unknown = {}): void {
  ws.emit('message', { data: JSON.stringify({ type: 'call', id: 'c1', name, args }) });
}
```

- [ ] **Step 2: Write the failing AgentButton test**

```tsx
// packages/react/src/components/AgentButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentButton', () => {
  it('registers a no-arg tool, anchors the element, and pushes live label/disabled state', async () => {
    const { EmbinderProvider, AgentButton } = await loadSdk();
    const { getByRole } = render(
      <EmbinderProvider>
        <AgentButton name="save" description="Save the form">Save</AgentButton>
      </EmbinderProvider>,
    );
    expect(getByRole('button').getAttribute('data-embinder-tool')).toBe('save');

    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.name).toBe('save');
    expect(reg.tool.description).toBe('Save the form');
    // no-arg tool: empty properties, no required
    expect(reg.tool.inputSchema.properties).toEqual({});
    // not context-only: it has a handler
    expect(reg.tool.annotations?.embinderContextOnly).toBeUndefined();

    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'save', state: { label: 'Save', disabled: false } });
  });

  it('clicks the real button when the agent calls the tool', async () => {
    const { EmbinderProvider, AgentButton } = await loadSdk();
    const onClick = vi.fn();
    render(
      <EmbinderProvider>
        <AgentButton name="save" description="x" onClick={onClick}>Save</AgentButton>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'save', {});
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });

  it('sets destructiveHint when destructive', async () => {
    const { EmbinderProvider, AgentButton } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentButton name="wipe" description="x" destructive>Wipe</AgentButton>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: { annotations?: Record<string, unknown> } };
    expect(reg.tool.annotations?.destructiveHint).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/AgentButton.test.tsx`
Expected: FAIL — `AgentButton` is not exported / not defined.

- [ ] **Step 4: Write the factory**

```tsx
// packages/react/src/components/createAgentElement.tsx
// Internal factory: turns an adapter (element type + how it maps to an MCP tool)
// into an agent-aware React component. Every Agent* component is built from this.
// The component renders the real native element, registers a tool via useEmbinder,
// and pushes live DOM state through the same context() channel.
import { createElement, forwardRef, useRef, type ComponentPropsWithoutRef, type Ref } from 'react';
import type { ZodTypeAny } from 'zod';
import { useEmbinder } from '../use-embinder.js';

export interface AgentSharedProps {
  /** Unique per mounted screen. */
  name: string;
  /** Prompt context surfaced to the agent via tools/list. */
  description: string;
  /** Marks the capability destructive (policy file still wins). */
  destructive?: boolean;
  title?: string;
  /** Override the auto live-state selector. */
  context?: () => unknown;
}

export type AgentTag = 'button' | 'input' | 'textarea' | 'select' | 'div' | 'a';

export interface AgentAdapter<T extends AgentTag, E extends HTMLElement, A> {
  tag: T;
  /** Fixed element props merged first (e.g. { type: 'checkbox' }, { role: 'switch' }). */
  fixedProps?: Record<string, unknown>;
  /** Zod raw shape for tool input; omitted => no-arg action. */
  input?: Record<string, ZodTypeAny>;
  /** No handler => context-only pointer (contributes state, never callable). */
  contextOnly?: boolean;
  /** Agent-callable behavior: dispatch native events on the ref. */
  execute?: (el: E, args: A) => void;
  /** Live read-only state, sampled after each commit. */
  readState: (el: E) => unknown;
}

function mergeRefs<T>(a: Ref<T>, b: Ref<T> | undefined) {
  return (value: T | null) => {
    for (const r of [a, b]) {
      if (typeof r === 'function') r(value);
      else if (r && typeof r === 'object') (r as { current: T | null }).current = value;
    }
  };
}

// Generic over the concrete tag T so the returned component keeps element-specific
// props (placeholder, href, checked, ...) instead of the lossy union of all tags.
export function createAgentElement<T extends AgentTag, E extends HTMLElement, A>(
  adapter: AgentAdapter<T, E, A>,
) {
  type Props = AgentSharedProps & ComponentPropsWithoutRef<T>;
  const Component = forwardRef<E, Props>((props, forwardedRef) => {
    const { name, description, destructive, title, context, ...native } = props;
    const ref = useRef<E>(null);
    const bind = useEmbinder({
      name,
      description,
      title,
      destructive,
      input: adapter.input,
      handler: adapter.contextOnly
        ? undefined
        : (args: never) => adapter.execute?.(ref.current as E, args as A),
      context: context ?? (() => (ref.current ? adapter.readState(ref.current) : {})),
    });
    return createElement(adapter.tag, {
      ...adapter.fixedProps,
      ...native,
      ...bind,
      ref: mergeRefs(ref, forwardedRef as Ref<E>),
    });
  });
  return Component;
}
```

- [ ] **Step 5: Write AgentButton**

```tsx
// packages/react/src/components/AgentButton.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';

export type AgentButtonProps = AgentSharedProps & ComponentPropsWithoutRef<'button'>;

/** Agent-aware <button>: the agent clicks it; no handler needed. */
export const AgentButton = createAgentElement<'button', HTMLButtonElement, void>({
  tag: 'button',
  execute: (el) => el.click(),
  readState: (el) => ({ label: el.textContent ?? '', disabled: el.disabled }),
});
```

- [ ] **Step 6: Export AgentButton so `loadSdk()` sees it**

Add to `packages/react/src/index.ts` (append after the existing exports):

```ts
// Agent-aware wrapper components (declarative override of native elements).
export { AgentButton } from './components/AgentButton.js';
export type { AgentButtonProps } from './components/AgentButton.js';
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/AgentButton.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck --workspace @embinder/react`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/components/agent-test-harness.tsx packages/react/src/components/createAgentElement.tsx packages/react/src/components/AgentButton.tsx packages/react/src/components/AgentButton.test.tsx packages/react/src/index.ts
git commit -m "feat(react): createAgentElement factory + AgentButton"
```

---

## Task 3: AgentInput

**Files:**
- Create: `packages/react/src/components/AgentInput.tsx`
- Test: `packages/react/src/components/AgentInput.test.tsx`
- Modify: `packages/react/src/index.ts`

**Interfaces:**
- Consumes: `createAgentElement`, `AgentSharedProps`; `fireInputValue` from `./dispatch.js`.
- Produces: `AgentInput` component; `type AgentInputProps = AgentSharedProps & ComponentPropsWithoutRef<'input'>`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/react/src/components/AgentInput.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentInput', () => {
  it('registers a { value } tool and pushes live value/placeholder/disabled', async () => {
    const { EmbinderProvider, AgentInput } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentInput name="task_text" description="The new task text" placeholder="Task…" defaultValue="milk" />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.name).toBe('task_text');
    expect(reg.tool.inputSchema.properties.value.type).toBe('string');
    expect(reg.tool.inputSchema.required).toEqual(['value']);
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({
      name: 'task_text',
      state: { value: 'milk', placeholder: 'Task…', disabled: false },
    });
  });

  it('sets the controlled value and fires the developer onChange when the agent calls it', async () => {
    const { EmbinderProvider, AgentInput } = await loadSdk();
    const seen: string[] = [];
    function Controlled() {
      const [v, setV] = useState('');
      return (
        <AgentInput
          name="task_text"
          description="x"
          value={v}
          onChange={(e) => {
            seen.push(e.target.value);
            setV(e.target.value);
          }}
        />
      );
    }
    render(
      <EmbinderProvider>
        <Controlled />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'task_text', { value: 'eggs' });
    await waitFor(() => expect(seen).toContain('eggs'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/AgentInput.test.tsx`
Expected: FAIL — `AgentInput` not exported.

- [ ] **Step 3: Write AgentInput**

```tsx
// packages/react/src/components/AgentInput.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';
import { fireInputValue } from './dispatch.js';

export type AgentInputProps = AgentSharedProps & ComponentPropsWithoutRef<'input'>;

/** Agent-aware <input>: the agent sets its value; the developer's onChange fires. */
export const AgentInput = createAgentElement<'input', HTMLInputElement, { value: string }>({
  tag: 'input',
  input: { value: z.string().describe('The value to type into the field') },
  execute: (el, { value }) => fireInputValue(el, value),
  readState: (el) => ({ value: el.value, placeholder: el.placeholder, disabled: el.disabled }),
});
```

- [ ] **Step 4: Export it**

Append to `packages/react/src/index.ts`:

```ts
export { AgentInput } from './components/AgentInput.js';
export type { AgentInputProps } from './components/AgentInput.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/AgentInput.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/components/AgentInput.tsx packages/react/src/components/AgentInput.test.tsx packages/react/src/index.ts
git commit -m "feat(react): AgentInput agent component"
```

---

## Task 4: AgentSelect

**Files:**
- Create: `packages/react/src/components/AgentSelect.tsx`
- Test: `packages/react/src/components/AgentSelect.test.tsx`
- Modify: `packages/react/src/index.ts`

**Interfaces:**
- Consumes: `createAgentElement`, `AgentSharedProps`; `fireSelectValue` from `./dispatch.js`.
- Produces: `AgentSelect`; `type AgentSelectProps = AgentSharedProps & ComponentPropsWithoutRef<'select'>`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/react/src/components/AgentSelect.test.tsx
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentSelect', () => {
  it('registers a { value } tool and reports options + current value as live state', async () => {
    const { EmbinderProvider, AgentSelect } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentSelect name="priority" description="Task priority" defaultValue="low">
          <option value="low">Low</option>
          <option value="high">High</option>
        </AgentSelect>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties.value.type).toBe('string');
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({
      name: 'priority',
      state: { value: 'low', options: ['low', 'high'], disabled: false },
    });
  });

  it('selects the option and fires onChange when the agent sets a valid value', async () => {
    const { EmbinderProvider, AgentSelect } = await loadSdk();
    const seen: string[] = [];
    function Controlled() {
      const [v, setV] = useState('low');
      return (
        <AgentSelect
          name="priority"
          description="x"
          value={v}
          onChange={(e) => {
            seen.push(e.target.value);
            setV(e.target.value);
          }}
        >
          <option value="low">Low</option>
          <option value="high">High</option>
        </AgentSelect>
      );
    }
    render(
      <EmbinderProvider>
        <Controlled />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'priority', { value: 'high' });
    await waitFor(() => expect(seen).toContain('high'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/AgentSelect.test.tsx`
Expected: FAIL — `AgentSelect` not exported.

- [ ] **Step 3: Write AgentSelect**

```tsx
// packages/react/src/components/AgentSelect.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';
import { fireSelectValue } from './dispatch.js';

export type AgentSelectProps = AgentSharedProps & ComponentPropsWithoutRef<'select'>;

/** Agent-aware <select>: the agent picks an option value; unknown values no-op. */
export const AgentSelect = createAgentElement<'select', HTMLSelectElement, { value: string }>({
  tag: 'select',
  input: { value: z.string().describe('The option value to select') },
  execute: (el, { value }) => {
    const known = Array.from(el.options).some((o) => o.value === value);
    if (known) fireSelectValue(el, value);
  },
  readState: (el) => ({
    value: el.value,
    options: Array.from(el.options).map((o) => o.value),
    disabled: el.disabled,
  }),
});
```

- [ ] **Step 4: Export it**

Append to `packages/react/src/index.ts`:

```ts
export { AgentSelect } from './components/AgentSelect.js';
export type { AgentSelectProps } from './components/AgentSelect.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/AgentSelect.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/components/AgentSelect.tsx packages/react/src/components/AgentSelect.test.tsx packages/react/src/index.ts
git commit -m "feat(react): AgentSelect agent component"
```

---

## Task 5: AgentDiv (context-only)

**Files:**
- Create: `packages/react/src/components/AgentDiv.tsx`
- Test: `packages/react/src/components/AgentDiv.test.tsx`
- Modify: `packages/react/src/index.ts`

**Interfaces:**
- Consumes: `createAgentElement`, `AgentSharedProps`.
- Produces: `AgentDiv`; `type AgentDivProps = AgentSharedProps & ComponentPropsWithoutRef<'div'>`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/react/src/components/AgentDiv.test.tsx
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { setupFakeRelay, loadSdk, socket } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentDiv', () => {
  it('registers as a context-only pointer and pushes text content by default', async () => {
    const { EmbinderProvider, AgentDiv } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentDiv name="status_panel" description="Current status">Ready</AgentDiv>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: { annotations?: Record<string, unknown> } };
    expect(reg.tool.annotations?.embinderContextOnly).toBe(true);
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'status_panel', state: { text: 'Ready' } });
  });

  it('honors a custom context selector override', async () => {
    const { EmbinderProvider, AgentDiv } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentDiv name="cart" description="Cart" context={() => ({ items: 3 })}>x</AgentDiv>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'cart', state: { items: 3 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/AgentDiv.test.tsx`
Expected: FAIL — `AgentDiv` not exported.

- [ ] **Step 3: Write AgentDiv**

```tsx
// packages/react/src/components/AgentDiv.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';

export type AgentDivProps = AgentSharedProps & ComponentPropsWithoutRef<'div'>;

/** Agent-aware <div>: read-only context surface (no callable tool). */
export const AgentDiv = createAgentElement<'div', HTMLDivElement, void>({
  tag: 'div',
  contextOnly: true,
  readState: (el) => ({ text: el.textContent ?? '' }),
});
```

- [ ] **Step 4: Export it**

Append to `packages/react/src/index.ts`:

```ts
export { AgentDiv } from './components/AgentDiv.js';
export type { AgentDivProps } from './components/AgentDiv.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/AgentDiv.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/components/AgentDiv.tsx packages/react/src/components/AgentDiv.test.tsx packages/react/src/index.ts
git commit -m "feat(react): AgentDiv context-only agent component"
```

---

## Task 6: AgentCheckbox

**Files:**
- Create: `packages/react/src/components/AgentCheckbox.tsx`
- Test: `packages/react/src/components/AgentCheckbox.test.tsx`
- Modify: `packages/react/src/index.ts`

**Interfaces:**
- Consumes: `createAgentElement`, `AgentSharedProps`; `fireCheckbox` from `./dispatch.js`.
- Produces: `AgentCheckbox`; `type AgentCheckboxProps = AgentSharedProps & ComponentPropsWithoutRef<'input'>`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/react/src/components/AgentCheckbox.test.tsx
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentCheckbox', () => {
  it('registers a { checked } tool and pushes live checked/disabled', async () => {
    const { EmbinderProvider, AgentCheckbox } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentCheckbox name="done" description="Mark task done" defaultChecked={false} />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties.checked.type).toBe('boolean');
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'done', state: { checked: false, disabled: false } });
  });

  it('toggles to the requested checked state and fires onChange', async () => {
    const { EmbinderProvider, AgentCheckbox } = await loadSdk();
    const seen: boolean[] = [];
    function Controlled() {
      const [c, setC] = useState(false);
      return (
        <AgentCheckbox
          name="done"
          description="x"
          checked={c}
          onChange={(e) => {
            seen.push(e.target.checked);
            setC(e.target.checked);
          }}
        />
      );
    }
    render(
      <EmbinderProvider>
        <Controlled />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'done', { checked: true });
    await waitFor(() => expect(seen).toContain(true));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/AgentCheckbox.test.tsx`
Expected: FAIL — `AgentCheckbox` not exported.

- [ ] **Step 3: Write AgentCheckbox**

```tsx
// packages/react/src/components/AgentCheckbox.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';
import { fireCheckbox } from './dispatch.js';

export type AgentCheckboxProps = AgentSharedProps & ComponentPropsWithoutRef<'input'>;

/** Agent-aware checkbox: the agent sets checked; the developer's onChange fires. */
export const AgentCheckbox = createAgentElement<'input', HTMLInputElement, { checked: boolean }>({
  tag: 'input',
  fixedProps: { type: 'checkbox' },
  input: { checked: z.boolean().describe('The desired checked state') },
  execute: (el, { checked }) => fireCheckbox(el, checked),
  readState: (el) => ({ checked: el.checked, disabled: el.disabled }),
});
```

- [ ] **Step 4: Export it**

Append to `packages/react/src/index.ts`:

```ts
export { AgentCheckbox } from './components/AgentCheckbox.js';
export type { AgentCheckboxProps } from './components/AgentCheckbox.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/AgentCheckbox.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/components/AgentCheckbox.tsx packages/react/src/components/AgentCheckbox.test.tsx packages/react/src/index.ts
git commit -m "feat(react): AgentCheckbox agent component"
```

---

## Task 7: AgentRadioGroup

The one grouping component: it renders a `<div role="radiogroup">` wrapping the developer's plain radio `<input>`s and registers a single `{ value }` tool. `execute` clicks the child radio whose `value` matches; `readState` reports the option values and the currently-checked one.

**Files:**
- Create: `packages/react/src/components/AgentRadioGroup.tsx`
- Test: `packages/react/src/components/AgentRadioGroup.test.tsx`
- Modify: `packages/react/src/index.ts`

**Interfaces:**
- Consumes: `createAgentElement`, `AgentSharedProps`.
- Produces: `AgentRadioGroup`; `type AgentRadioGroupProps = AgentSharedProps & ComponentPropsWithoutRef<'div'>`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/react/src/components/AgentRadioGroup.test.tsx
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentRadioGroup', () => {
  it('registers one { value } tool and reports child radio options + checked value', async () => {
    const { EmbinderProvider, AgentRadioGroup } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentRadioGroup name="size" description="T-shirt size">
          <label><input type="radio" name="size" value="s" defaultChecked /> S</label>
          <label><input type="radio" name="size" value="m" /> M</label>
        </AgentRadioGroup>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties.value.type).toBe('string');
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({
      name: 'size',
      state: { value: 's', options: ['s', 'm'] },
    });
  });

  it('checks the matching radio and fires its onChange; unknown value no-ops', async () => {
    const { EmbinderProvider, AgentRadioGroup } = await loadSdk();
    const seen: string[] = [];
    function Controlled() {
      const [v, setV] = useState('s');
      const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        seen.push(e.target.value);
        setV(e.target.value);
      };
      return (
        <AgentRadioGroup name="size" description="x">
          <label><input type="radio" name="size" value="s" checked={v === 's'} onChange={onChange} /> S</label>
          <label><input type="radio" name="size" value="m" checked={v === 'm'} onChange={onChange} /> M</label>
        </AgentRadioGroup>
      );
    }
    render(
      <EmbinderProvider>
        <Controlled />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'size', { value: 'm' });
    await waitFor(() => expect(seen).toContain('m'));
    callTool(ws, 'size', { value: 'xl' }); // unknown -> no throw, no new onChange
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).not.toContain('xl');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/AgentRadioGroup.test.tsx`
Expected: FAIL — `AgentRadioGroup` not exported.

- [ ] **Step 3: Write AgentRadioGroup**

```tsx
// packages/react/src/components/AgentRadioGroup.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';

export type AgentRadioGroupProps = AgentSharedProps & ComponentPropsWithoutRef<'div'>;

function radios(el: HTMLDivElement): HTMLInputElement[] {
  return Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
}

/** Agent-aware radio group: one { value } tool that checks the matching child radio. */
export const AgentRadioGroup = createAgentElement<'div', HTMLDivElement, { value: string }>({
  tag: 'div',
  fixedProps: { role: 'radiogroup' },
  input: { value: z.string().describe('The value of the radio option to select') },
  execute: (el, { value }) => {
    const target = radios(el).find((r) => r.value === value);
    if (target && !target.checked) target.click();
  },
  readState: (el) => {
    const rs = radios(el);
    return { value: rs.find((r) => r.checked)?.value ?? '', options: rs.map((r) => r.value) };
  },
});
```

- [ ] **Step 4: Export it**

Append to `packages/react/src/index.ts`:

```ts
export { AgentRadioGroup } from './components/AgentRadioGroup.js';
export type { AgentRadioGroupProps } from './components/AgentRadioGroup.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/AgentRadioGroup.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/components/AgentRadioGroup.tsx packages/react/src/components/AgentRadioGroup.test.tsx packages/react/src/index.ts
git commit -m "feat(react): AgentRadioGroup agent component"
```

---

## Task 8: AgentToggle

A switch rendered as `<button role="switch">`. The developer manages the on/off state and reflects it in `aria-checked`; the agent sets `{ on }` and we click only when the current `aria-checked` differs.

**Files:**
- Create: `packages/react/src/components/AgentToggle.tsx`
- Test: `packages/react/src/components/AgentToggle.test.tsx`
- Modify: `packages/react/src/index.ts`

**Interfaces:**
- Consumes: `createAgentElement`, `AgentSharedProps`; `clickIfState` from `./dispatch.js`.
- Produces: `AgentToggle`; `type AgentToggleProps = AgentSharedProps & ComponentPropsWithoutRef<'button'>`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/react/src/components/AgentToggle.test.tsx
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentToggle', () => {
  it('registers an { on } tool and pushes live on/disabled from aria-checked', async () => {
    const { EmbinderProvider, AgentToggle } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentToggle name="notify" description="Notifications" aria-checked={false}>Off</AgentToggle>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties.on.type).toBe('boolean');
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({ name: 'notify', state: { on: false, disabled: false } });
  });

  it('clicks to reach the requested on state, and no-ops when already there', async () => {
    const { EmbinderProvider, AgentToggle } = await loadSdk();
    let clicks = 0;
    function Controlled() {
      const [on, setOn] = useState(false);
      return (
        <AgentToggle
          name="notify"
          description="x"
          aria-checked={on}
          onClick={() => {
            clicks += 1;
            setOn((v) => !v);
          }}
        >
          {on ? 'On' : 'Off'}
        </AgentToggle>
      );
    }
    render(
      <EmbinderProvider>
        <Controlled />
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'notify', { on: true });
    await waitFor(() => expect(clicks).toBe(1));
    callTool(ws, 'notify', { on: true }); // already on -> no extra click
    await new Promise((r) => setTimeout(r, 50));
    expect(clicks).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/AgentToggle.test.tsx`
Expected: FAIL — `AgentToggle` not exported.

- [ ] **Step 3: Write AgentToggle**

```tsx
// packages/react/src/components/AgentToggle.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';
import { clickIfState } from './dispatch.js';

export type AgentToggleProps = AgentSharedProps & ComponentPropsWithoutRef<'button'>;

const isOn = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true';

/** Agent-aware switch (<button role="switch">): the agent sets { on } by clicking. */
export const AgentToggle = createAgentElement<'button', HTMLButtonElement, { on: boolean }>({
  tag: 'button',
  fixedProps: { role: 'switch' },
  input: { on: z.boolean().describe('The desired on/off state') },
  execute: (el, { on }) => clickIfState(el, on, isOn),
  readState: (el) => ({ on: isOn(el), disabled: el.disabled }),
});
```

- [ ] **Step 4: Export it**

Append to `packages/react/src/index.ts`:

```ts
export { AgentToggle } from './components/AgentToggle.js';
export type { AgentToggleProps } from './components/AgentToggle.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/AgentToggle.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/components/AgentToggle.tsx packages/react/src/components/AgentToggle.test.tsx packages/react/src/index.ts
git commit -m "feat(react): AgentToggle agent component"
```

---

## Task 9: AgentLink

**Files:**
- Create: `packages/react/src/components/AgentLink.tsx`
- Test: `packages/react/src/components/AgentLink.test.tsx`
- Modify: `packages/react/src/index.ts`

**Interfaces:**
- Consumes: `createAgentElement`, `AgentSharedProps`.
- Produces: `AgentLink`; `type AgentLinkProps = AgentSharedProps & ComponentPropsWithoutRef<'a'>`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/react/src/components/AgentLink.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentLink', () => {
  it('registers a no-arg tool and pushes live href/text', async () => {
    const { EmbinderProvider, AgentLink } = await loadSdk();
    render(
      <EmbinderProvider>
        <AgentLink name="go_docs" description="Open the docs" href="https://example.com/docs">Docs</AgentLink>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    const reg = ws.ofType('register')[0] as { tool: Record<string, any> };
    expect(reg.tool.inputSchema.properties).toEqual({});
    await waitFor(() => expect(ws.ofType('context').length).toBeGreaterThan(0));
    expect(ws.ofType('context')[0]).toMatchObject({
      name: 'go_docs',
      state: { href: 'https://example.com/docs', text: 'Docs' },
    });
  });

  it('clicks the anchor when the agent activates it', async () => {
    const { EmbinderProvider, AgentLink } = await loadSdk();
    const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(
      <EmbinderProvider>
        <AgentLink name="go_docs" description="x" href="#" onClick={onClick}>Docs</AgentLink>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register').length).toBe(1));
    callTool(ws, 'go_docs', {});
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @embinder/react -- src/components/AgentLink.test.tsx`
Expected: FAIL — `AgentLink` not exported.

- [ ] **Step 3: Write AgentLink**

```tsx
// packages/react/src/components/AgentLink.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';

export type AgentLinkProps = AgentSharedProps & ComponentPropsWithoutRef<'a'>;

/** Agent-aware <a>: the agent activates it with a native click. */
export const AgentLink = createAgentElement<'a', HTMLAnchorElement, void>({
  tag: 'a',
  execute: (el) => el.click(),
  readState: (el) => ({ href: el.getAttribute('href') ?? '', text: el.textContent ?? '' }),
});
```

Note: `readState` reads the `href` **attribute** (raw, e.g. `#`), not the resolved `el.href` property, so live state matches what the developer wrote.

- [ ] **Step 4: Export it**

Append to `packages/react/src/index.ts`:

```ts
export { AgentLink } from './components/AgentLink.js';
export type { AgentLinkProps } from './components/AgentLink.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @embinder/react -- src/components/AgentLink.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/components/AgentLink.tsx packages/react/src/components/AgentLink.test.tsx packages/react/src/index.ts
git commit -m "feat(react): AgentLink agent component"
```

---

## Task 10: Barrel export + full verification

Add the `components/index.ts` barrel (convenience import surface) and run the definition-of-done gates: full package test suite, typecheck, and the e2e regression guard.

**Files:**
- Create: `packages/react/src/components/index.ts`

**Interfaces:**
- Consumes: all 8 components + their prop types from the sibling files.
- Produces: a single barrel re-export (no new symbols).

- [ ] **Step 1: Write the barrel**

```ts
// packages/react/src/components/index.ts
// Convenience barrel for the agent-aware components.
export { AgentButton } from './AgentButton.js';
export type { AgentButtonProps } from './AgentButton.js';
export { AgentInput } from './AgentInput.js';
export type { AgentInputProps } from './AgentInput.js';
export { AgentSelect } from './AgentSelect.js';
export type { AgentSelectProps } from './AgentSelect.js';
export { AgentDiv } from './AgentDiv.js';
export type { AgentDivProps } from './AgentDiv.js';
export { AgentCheckbox } from './AgentCheckbox.js';
export type { AgentCheckboxProps } from './AgentCheckbox.js';
export { AgentRadioGroup } from './AgentRadioGroup.js';
export type { AgentRadioGroupProps } from './AgentRadioGroup.js';
export { AgentToggle } from './AgentToggle.js';
export type { AgentToggleProps } from './AgentToggle.js';
export { AgentLink } from './AgentLink.js';
export type { AgentLinkProps } from './AgentLink.js';
export { createAgentElement } from './createAgentElement.js';
export type { AgentSharedProps, AgentAdapter, AgentTag } from './createAgentElement.js';
```

- [ ] **Step 2: Run the full react test suite**

Run: `npm test --workspace @embinder/react`
Expected: PASS — all existing `useEmbinder`/chat tests plus the new `dispatch` + 8 component suites, 0 failures.

- [ ] **Step 3: Typecheck all workspaces**

Run: `npm run typecheck`
Expected: exit 0 across `@embinder/react` + `@embinder/relay`.

- [ ] **Step 4: e2e regression guard**

Run: `npm run e2e`
Expected: GREEN — "E2E + GATE GREEN" (unchanged; no relay/gate edits).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/components/index.ts
git commit -m "feat(react): barrel export for agent components + verify suite"
```

---

## Definition of Done (per project CLAUDE.md)

- All 10 tasks complete; every new test suite PASS.
- `npm run typecheck` exit 0 across workspaces.
- `npm run e2e` GREEN (regression: relay/gate untouched).
- `claude-progress.md` updated with a new session record and evidence (commands + real output).
- `feature_list.json`: if this work is tracked as a feature, mark it `passing` ONLY with evidence produced this session; otherwise add it as a new entry.

## Out-of-scope follow-ups (do not build now)

- Wiring an agent component into `apps/todo` for a live-browser demo (belongs with F-D8).
- Additional element types via the same factory (slider, date, file, distinct textarea component).
