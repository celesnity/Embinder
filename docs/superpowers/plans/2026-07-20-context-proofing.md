# Context Proofing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add declared, one-action focus scopes so agents discover nested UI context without receiving every descendant tool or summary at once.

**Architecture:** `AgentScope` declares a semantic UI-tree node and sends its tree metadata to the existing app WebSocket. Descendant `useEmbinder` registrations inherit the nearest scope ID. The relay keeps a per-session focus lease, filters MCP/chat capabilities to its active layer, creates virtual `focus_<scope>` tools, and clears the lease once one scoped action settles. Chat uses AI SDK `prepareStep` to refresh active tools and system context between focus and action steps in one reply.

**Tech Stack:** React 19, TypeScript ESM, Vitest, Zod raw shapes, MCP SDK, AI SDK `streamText`, driver.js.

## Global Constraints

- Context must be developer-declared semantic JSON only; never serialize DOM text, controls, or accessibility trees.
- Root tools remain direct; no action-level `direct` or `requiresFocus` configuration exists.
- Scope context uses the existing 150 ms debounce, JSON-stable update behavior, and 16 KB cap.
- Scope names are sibling-unique identifiers matching `^[A-Za-z][A-Za-z0-9_]*$`; focus tool names derive from full ancestry by replacing `/` with `__`.
- A focus lease is per MCP/chat session, permits exactly one scoped action, and clears only after that action settles.
- Unknown, stale, sibling, descendant, or cross-session scoped calls return `isError` before the browser app handler runs.
- Existing policy, canonicalization, rate limiting, audit behavior, gate decisions, and destructive spotlight lock remain unchanged.
- Maximum discoverable scope depth defaults to `3`; registrations deeper than this stay mounted but are not exposed until explicitly configured higher.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/react/src/scope-context.tsx` | React scope ancestry context and scope-ID creation. |
| `packages/react/src/components/AgentScope.tsx` | Public scope wrapper, semantic summary transport, anchor attribute. |
| `packages/react/src/components/AgentScope.test.tsx` | Public React/protocol behavior. |
| `packages/react/src/use-embinder.ts` | Attach nearest scope ID to existing tool registrations. |
| `packages/react/src/provider.tsx` | Transport `scope-register`, `scope-context`, `scope-unregister`; forward `focus` phase. |
| `packages/react/src/resolve-target.ts` | Resolve scope anchors for driver.js and ghost cursor. |
| `packages/react/src/spotlight.ts` | Highlight a focus target without gate lock. |
| `packages/react/src/ghost-cursor.ts` | Move cursor to a focus target, then resume idle state. |
| `packages/relay/src/scope-tree.ts` | Scope tree, virtual focus descriptors, per-session lease selection and reservation. |
| `packages/relay/src/scope-tree.test.ts` | Scope visibility, depth, replacement, reservation, cleanup, isolation. |
| `packages/relay/src/registry.ts` | Persist `scopeId` on capability definitions; delegate selected entries to `ScopeTree`. |
| `packages/relay/src/server.ts` | Receive scope messages; synchronize session MCP tools; enforce leases before gate. |
| `packages/relay/src/chat.ts` | Build selected-layer tool map/context; refresh it using `prepareStep`. |
| `packages/relay/src/chat.test.ts` | Prove selected context and focus-to-action chat refresh. |
| `apps/todo/src/components/TaskCard.tsx` | Demonstrate a per-task declared scope; wire proof stays in e2e. |
| `scripts/e2e.mjs` | Wire-level proof of root/focus/action/restore behavior. |
| `packages/react/src/index.ts`, `packages/react/src/components/index.ts` | Export `AgentScope` and its props. |

### Task 1: React `AgentScope` declaration and transport

**Files:**
- Create: `packages/react/src/scope-context.tsx`
- Create: `packages/react/src/components/AgentScope.tsx`
- Create: `packages/react/src/components/AgentScope.test.tsx`
- Modify: `packages/react/src/use-embinder.ts`
- Modify: `packages/react/src/provider.tsx`
- Modify: `packages/react/src/components/index.ts`
- Modify: `packages/react/src/index.ts`

**Interfaces:**

```ts
export interface AgentScopeProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  summary: () => unknown;
  children: React.ReactNode;
}

export interface ScopeRegistration {
  id: string;
  parentId?: string;
  name: string;
}

export interface ScopeTransport {
  registerScope(scope: ScopeRegistration): void;
  sendScopeContext(id: string, state: unknown): void;
  unregisterScope(id: string): void;
}
```

`useEmbinder()` reads the nearest scope ID and adds `embinderScope: scopeId` to its existing registration annotations. Scope messages are app-to-relay WebSocket messages:

```ts
{ type: 'scope-register', scope: { id, parentId, name } }
{ type: 'scope-context', id, state }
{ type: 'scope-unregister', id }
```

- [ ] **Step 1: Write failing public component tests**

Create `AgentScope.test.tsx`. Reuse the `FakeWebSocket`, `loadSdk`, cleanup, and socket-opening pattern from `use-embinder.test.tsx`. Assert one nested scope produces exact registration ordering-independent messages and child tool metadata:

```tsx
function Inbox() {
  const bind = useEmbinder({ name: 'archive_task', description: 'Archive task', handler: () => ({ ok: true }) });
  return (
    <AgentScope name="inbox" summary={() => ({ count: 2 })}>
      <button {...bind}>Archive</button>
    </AgentScope>
  );
}

expect(scopeRegister).toMatchObject({
  type: 'scope-register', scope: { id: 'inbox', parentId: undefined, name: 'inbox' },
});
expect(toolRegister.tool.annotations).toMatchObject({ embinderScope: 'inbox' });
expect(scopeContext).toMatchObject({ type: 'scope-context', id: 'inbox', state: { count: 2 } });
expect(screen.getByText('Archive').closest('[data-embinder-scope]')?.getAttribute('data-embinder-scope')).toBe('inbox');
```

Add tests for nested ID `inbox/task_42`, unchanged summary emitting no second update, summary change emitting one debounced update, invalid name throwing `AgentScope name must match`, and unmount emitting `scope-unregister`.

- [ ] **Step 2: Run React scope tests; verify red**

Run:

```bash
rtk npm test --workspace @embinder/react -- src/components/AgentScope.test.tsx
```

Expected: FAIL because `AgentScope` and scope transport messages do not exist.

- [ ] **Step 3: Add ancestry context and public wrapper**

Create `scope-context.tsx` with a context value containing `id?: string`. Create `scopeId(parentId, name)` using `parentId ? \`${parentId}/${name}\` : name`; validate `name` before rendering. `AgentScope` renders one `<div data-embinder-scope={id}>`, provides `{ id }` to descendants, registers on mount, sends `summary()` after commits with the same JSON-stable/debounced/16-KB rules as `useEmbinder`, and unregisters on cleanup.

The essential public implementation shape is:

```tsx
export function AgentScope({ name, summary, children, ...native }: AgentScopeProps) {
  const parentId = useAgentScopeId();
  const id = makeScopeId(parentId, name);
  useScopeTransport({ id, parentId, name, summary });
  return <ScopeContext.Provider value={id}><div {...native} data-embinder-scope={id}>{children}</div></ScopeContext.Provider>;
}
```

Keep the JSON/debounce helper private to this module. It must send the literal `"[truncated]"` marker used by `useEmbinder` for oversized summary JSON.

- [ ] **Step 4: Extend provider and tool annotation transport**

In `provider.tsx`, add `registerScope`, `sendScopeContext`, and `unregisterScope` to `Shim`, each calling its existing buffered `send`. Export module functions used only by `AgentScope`. In `use-embinder.ts`, read `useAgentScopeId()` during render and add the optional metadata without overwriting existing annotations:

```ts
annotations: {
  ...(descriptor.title ? { title: descriptor.title } : {}),
  ...(descriptor.destructive ? { destructiveHint: true } : {}),
  ...(scopeId ? { embinderScope: scopeId } : {}),
  ...(descriptor.handler ? {} : { embinderContextOnly: true }),
}
```

Export `AgentScope` and `AgentScopeProps` from both barrel files.

- [ ] **Step 5: Run focused React tests; verify green**

Run:

```bash
rtk npm test --workspace @embinder/react -- src/components/AgentScope.test.tsx src/use-embinder.test.tsx
```

Expected: AgentScope tests pass; existing hook tests pass unchanged.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/react/src/scope-context.tsx packages/react/src/components/AgentScope.tsx packages/react/src/components/AgentScope.test.tsx packages/react/src/use-embinder.ts packages/react/src/provider.tsx packages/react/src/components/index.ts packages/react/src/index.ts
git commit -m "feat(react): add declared AgentScope context"
```

### Task 2: Relay scope tree and session lease

**Files:**
- Create: `packages/relay/src/scope-tree.ts`
- Create: `packages/relay/src/scope-tree.test.ts`
- Modify: `packages/relay/src/registry.ts`
- Modify: `packages/relay/src/registry.test.ts`

**Interfaces:**

```ts
export interface ScopeDef { id: string; parentId?: string; name: string; contextState?: unknown; }
export interface ScopeLease { scopeId: string; reserved: boolean; }
export interface VisibleCapability { name: string; def: CapabilityDef; }

export class ScopeTree {
  register(scope: Omit<ScopeDef, 'contextState'>): void;
  setContext(id: string, state: unknown): void;
  unregister(id: string): string[];
  focus(sessionId: string, scopeId: string): { ok: true; state: unknown } | { ok: false; error: string };
  reserve(sessionId: string, scopeId: string): { ok: true } | { ok: false; error: string };
  settle(sessionId: string): void;
  visible(entries: Iterable<[string, CapabilityDef]>, sessionId: string): VisibleCapability[];
  focusTools(sessionId: string): Array<[string, CapabilityDef]>;
}
```

`CapabilityDef` gains `scopeId?: string`. `CapabilityRegistry.selectedEntries(sessionId)` returns `ScopeTree.visible(this.entries(), sessionId)` plus virtual focus definitions. `CapabilityRegistry.focus`, `reserveScopedAction`, and `settleScopedAction` delegate to the tree.

- [ ] **Step 1: Write failing scope-tree tests**

Create test fixtures for `inbox`, `inbox/task_42`, `archive`, and capability entries with `scopeId` undefined, `inbox`, `inbox/task_42`, and `archive`. Assert:

```ts
expect(tree.visible(entries, 's1').map((x) => x.name)).toEqual(['add_task']);
expect(tree.focusTools('s1').map(([name]) => name)).toEqual(['focus_inbox', 'focus_archive']);
expect(tree.focus('s1', 'inbox')).toEqual({ ok: true, state: { count: 2 } });
expect(tree.visible(entries, 's1').map((x) => x.name)).toEqual(['archive_task']);
expect(tree.focusTools('s1').map(([name]) => name)).toEqual(['focus_inbox__task_42']);
expect(tree.reserve('s1', 'inbox')).toEqual({ ok: true });
expect(tree.reserve('s1', 'inbox')).toEqual({ ok: false, error: 'scope action already reserved' });
tree.settle('s1');
expect(tree.visible(entries, 's1').map((x) => x.name)).toEqual(['add_task']);
```

Add isolated `s2` assertions, parent-invalid focus rejection, depth-four focus exclusion, replacement of an unreserved lease, descendant unregistration clearing affected lease, and context-only capability visibility.

- [ ] **Step 2: Run scope-tree tests; verify red**

Run:

```bash
rtk npm test --workspace @embinder/relay -- src/scope-tree.test.ts
```

Expected: FAIL because `scope-tree.ts` does not exist.

- [ ] **Step 3: Implement `ScopeTree`**

Use `Map<string, ScopeDef>` for nodes and `Map<string, ScopeLease>` for sessions. Root is represented by absent lease. A scope is focusable only when its `parentId` equals active scope ID (or both are absent). `visible()` returns root capabilities when no lease, otherwise capabilities whose `def.scopeId` equals lease scope ID. `focusTools()` returns virtual no-argument definitions only for direct children and only through depth three:

```ts
{ config: { description: `Focus ${scope.name}`, inputSchema: {} }, destructive: false }
```

Virtual focus tool names use `focus_${scope.id.replaceAll('/', '__')}`. `unregister()` removes the node and all descendants, then deletes leases pointing anywhere in that removed set.

- [ ] **Step 4: Integrate scope selection into registry**

Add `scopeId` to `CapabilityDef`. Add registry methods that preserve existing grace/call behavior:

```ts
selectedEntries(sessionId: string): Array<[string, CapabilityDef]>;
focus(sessionId: string, focusToolName: string): { ok: true; state: unknown } | { ok: false; error: string };
reserveScopedAction(sessionId: string, name: string): { scoped: boolean; ok: true } | { scoped: boolean; ok: false; error: string };
settleScopedAction(sessionId: string): void;
```

`reserveScopedAction` returns `{ scoped: false, ok: true }` for root tools. It maps a capability to `def.scopeId`, validates/reserves it for scoped tools, and never calls the browser. Extend `registry.test.ts` to prove capability metadata survives registration and selection honors the tree.

- [ ] **Step 5: Run focused relay tests; verify green**

Run:

```bash
rtk npm test --workspace @embinder/relay -- src/scope-tree.test.ts src/registry.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/relay/src/scope-tree.ts packages/relay/src/scope-tree.test.ts packages/relay/src/registry.ts packages/relay/src/registry.test.ts
git commit -m "feat(relay): add scoped context leases"
```

### Task 3: MCP visibility, focus execution, and gate enforcement

**Files:**
- Modify: `packages/relay/src/server.ts`
- Modify: `packages/relay/src/registry.test.ts`
- Modify: `scripts/e2e.mjs`

**Interfaces:**

```ts
interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  tools: Map<string, ReturnType<McpServer['registerTool']>>;
}

function syncSessionTools(sessionId: string, session: Session): void;
function registerFocusTool(sessionId: string, session: Session, name: string, def: CapabilityDef): void;
```

- [ ] **Step 1: Add failing wire-level focus assertions**

In `scripts/e2e.mjs`, extend the existing in-process app bridge fixture with one scope and one scoped tool. Assert this exact sequence:

```js
expect((await listTools(mcp)).tools.map((t) => t.name)).toContain('focus_inbox');
expect((await listTools(mcp)).tools.map((t) => t.name)).not.toContain('archive_task');
await callTool(mcp, 'focus_inbox', {});
expect((await listTools(mcp)).tools.map((t) => t.name)).toContain('archive_task');
await callTool(mcp, 'archive_task', { id: 't1' });
expect((await listTools(mcp)).tools.map((t) => t.name)).not.toContain('archive_task');
```

Also attempt `archive_task` before focus. Assert `isError === true` and that the bridge handler count remains zero.

- [ ] **Step 2: Run e2e focus case; verify red**

Run:

```bash
rtk npm run e2e
```

Expected: new focus assertions fail because relay registers all tools for every session.

- [ ] **Step 3: Receive scope messages and synchronize each MCP session**

In the app WebSocket switch in `server.ts`, add exact branches:

```ts
case 'scope-register': registry.registerScope(m.scope); syncAllSessionTools(); break;
case 'scope-context': registry.setScopeContext(m.id, m.state); break;
case 'scope-unregister': registry.unregisterScope(m.id); syncAllSessionTools(); break;
```

Replace unconditional `registerGatedTool` fan-out with `syncSessionTools`. It computes `registry.selectedEntries(sessionId)`, removes any registered tool absent from that set, and registers/replaces each selected entry. Register focus tools through `registerFocusTool`; their executor calls `registry.focus(extra.sessionId ?? sessionId, name)`, synchronizes that session, emits the `focus` app phase, and returns either JSON text state or `isError: true` without using `runGatedCall`.

Use the same `syncSessionTools` when a capability adds/removes, a scope changes, and a focus action succeeds. `buildSessionServer` must call it after its disabled primer exists.

- [ ] **Step 4: Reserve scoped action before gate and always settle**

At start of `runGatedCall`, call `registry.reserveScopedAction(session ?? '', name)`. If it fails, return an MCP `CallToolResult` with `isError: true` and text equal to the returned error; do not emit an `intent`, call `gate`, or forward to browser. If it reserved a scoped action, wrap the current gate/forward body in `try/finally`:

```ts
try {
  // existing canonicalize, phase, gate, and forward behavior
} finally {
  if (reservation.scoped) {
    registry.settleScopedAction(session ?? '');
    syncSessionToolsById(session);
  }
}
```

Use the transport's actual `extra.sessionId` for MCP. For chat, preserve the existing generated `chat:<uuid>` string. A destructive scoped action remains reserved while approval is pending because `finally` runs only after `gate()` settles.

- [ ] **Step 5: Run e2e and focused relay tests; verify green**

Run:

```bash
rtk npm test --workspace @embinder/relay -- src/registry.test.ts
rtk npm run e2e
```

Expected: registry tests pass; e2e reports all existing assertions plus new root/focus/action/restore/stale-call assertions as PASS and ends with `E2E + GATE GREEN`.

- [ ] **Step 6: Commit Task 3**

```bash
git add packages/relay/src/server.ts packages/relay/src/registry.test.ts scripts/e2e.mjs
git commit -m "feat(relay): expose one focused context layer"
```

### Task 4: Same-reply chat tool refresh

**Files:**
- Modify: `packages/relay/src/chat.ts`
- Modify: `packages/relay/src/chat.test.ts`

**Interfaces:**

```ts
export interface ScopedChatRegistry {
  selectedEntries(sessionId: string): Array<[string, CapabilityDef]>;
  focus(sessionId: string, focusToolName: string): { ok: true; state: unknown } | { ok: false; error: string };
}

export function buildScopedToolMap(deps: ChatDeps, session: string, signal: AbortSignal): Record<string, ReturnType<typeof tool>>;
export function selectedToolNames(registry: ScopedChatRegistry, session: string): string[];
```

- [ ] **Step 1: Write failing chat selection and refresh tests**

Extend `chat.test.ts` with a fake registry whose root has `focus_inbox`, and whose focused selection contains `archive_task`. Test the context block and active tool names before/after executing focus:

```ts
const tools = buildScopedToolMap(deps, 'chat:test', new AbortController().signal);
expect(selectedToolNames(registry, 'chat:test')).toEqual(['focus_inbox']);
await tools.focus_inbox.execute({});
expect(selectedToolNames(registry, 'chat:test')).toEqual(['archive_task']);
expect(buildOnScreenBlock(registry.selectedEntries('chat:test'))).toContain('archive_task');
```

Add a `prepareStep` test by capturing the callback passed to a mocked `streamText`, executing focus, then asserting its next invocation returns `activeTools: ['archive_task']` and a system block without root-only tools. Add error-path test: failed focus returns a tool error and leaves root active.

- [ ] **Step 2: Run chat tests; verify red**

Run:

```bash
rtk npm test --workspace @embinder/relay -- src/chat.test.ts
```

Expected: FAIL because chat currently creates one static tool map and system block.

- [ ] **Step 3: Build full map once, select active tools per AI SDK step**

Change `ChatDeps.registry` to require `selectedEntries` and `focus`. Build all currently rendered, callable actions plus virtual focus tools into one map. Each focus tool executes `registry.focus(session, name)` and returns the semantic summary; normal tool executors continue using `runGatedCall`.

Pass AI SDK `prepareStep` to `streamText`:

```ts
prepareStep: () => {
  const entries = deps.registry.selectedEntries(session);
  return {
    activeTools: callableTools(entries).map(([name]) => name),
    system: buildOnScreenBlock(entries),
  };
},
```

Set `tools` to the complete map so a newly active scoped action already has a definition. `prepareStep` runs before each model step; its selected `activeTools` prevents hidden descendants from appearing in the model's current schema. Keep `stopWhen: stepCountIs(6)` unchanged so refreshes do not reset the global reply limit.

- [ ] **Step 4: Run chat tests; verify green**

Run:

```bash
rtk npm test --workspace @embinder/relay -- src/chat.test.ts
```

Expected: chat unit tests pass, including focus-to-action active-tool refresh and rejected focus behavior.

- [ ] **Step 5: Commit Task 4**

```bash
git add packages/relay/src/chat.ts packages/relay/src/chat.test.ts
git commit -m "feat(chat): refresh scoped tools after focus"
```

### Task 5: Focus visualization and Todo proof

**Files:**
- Modify: `packages/react/src/resolve-target.ts`
- Modify: `packages/react/src/resolve-target.test.ts`
- Modify: `packages/react/src/spotlight.ts`
- Modify: `packages/react/src/ghost-cursor.ts`
- Modify: `apps/todo/src/components/TaskCard.tsx`

**Interfaces:**

```ts
export interface PhaseMessage {
  type: 'intent' | 'gate' | 'decided' | 'call' | 'done' | 'focus';
  name?: string;
  scopeId?: string;
  argsPreview?: unknown;
}

export function resolveAgentTarget(name: string, itemId?: string, scopeId?: string): Element | undefined;
```

- [ ] **Step 1: Write failing target and component proof tests**

Add to `resolve-target.test.ts`:

```ts
const scope = document.createElement('section');
scope.setAttribute('data-embinder-scope', 'inbox/task_t1');
document.body.append(scope);
expect(resolveAgentTarget('focus_inbox__task_t1', undefined, 'inbox/task_t1')).toBe(scope);
```

Extend the TaskCard fixture in `scripts/e2e.mjs` to assert its outer task-card region registers `tasks/task_t1`, sends summary `{ id: 't1', text: 'Milk', done: false }`, and declares task actions with that scope. The Todo workspace has no test runner; keep its component proof in the existing repository e2e harness.

- [ ] **Step 2: Run focused React/Todo tests; verify red**

Run:

```bash
rtk npm test --workspace @embinder/react -- src/resolve-target.test.ts
rtk npm run e2e
```

Expected: scope target and e2e TaskCard-scope assertions fail before implementation.

- [ ] **Step 3: Route `focus` phase to driver.js and ghost cursor**

Extend `resolveAgentTarget` to check `[data-embinder-scope="${escapedScopeId}"]` when `scopeId` is present before its existing tool/item lookup. In `spotlight.ts`, handle `focus` by calling `show` with the focus tool name, a short `Focused` description, no `lock`, no decision button, then schedule clearing after 700 ms. In `ghost-cursor.ts`, handle `focus` by moving to `resolveAgentTarget(name, undefined, scopeId)`, applying working state briefly, then resuming idle; do not enter gate-pending state.

Preserve all existing intent/gate/decision/call/done behavior exactly.

- [ ] **Step 4: Declare task-card scopes in Todo**

Wrap each TaskCard's existing card root and agent-aware descendants with:

```tsx
<AgentScope name={`task_${task.id}`} summary={() => ({ id: task.id, text: task.text, done: task.done })}>
  {/* existing card UI */}
</AgentScope>
```

Keep board-level creation/navigation controls outside the scope so they remain direct. Do not create scope wrappers around static decorative DOM.

- [ ] **Step 5: Run visual/component tests; verify green**

Run:

```bash
rtk npm test --workspace @embinder/react -- src/resolve-target.test.ts
rtk npm run e2e
```

Expected: target tests pass; e2e ends `E2E + GATE GREEN` and includes TaskCard-scope assertions.

- [ ] **Step 6: Commit Task 5**

```bash
git add packages/react/src/resolve-target.ts packages/react/src/resolve-target.test.ts packages/react/src/spotlight.ts packages/react/src/ghost-cursor.ts apps/todo/src/components/TaskCard.tsx scripts/e2e.mjs
git commit -m "feat(viz): show focused agent scopes"
```

### Task 6: Full verification and project evidence

**Files:**
- Modify: `feature_list.json`
- Modify: `claude-progress.md`

- [ ] **Step 1: Run React suite**

Run:

```bash
rtk npm test --workspace @embinder/react
```

Expected: all React Vitest files pass, including AgentScope and target tests.

- [ ] **Step 2: Run relay suite**

Run:

```bash
rtk npm test --workspace @embinder/relay
```

Expected: all relay Vitest files pass, including scope-tree, registry, and chat refresh tests.

- [ ] **Step 3: Run repository gates**

Run:

```bash
rtk npm run typecheck
rtk npm run e2e
```

Expected: typecheck exits 0 across workspaces; e2e ends `E2E + GATE GREEN`, with focus root/focus/action/restore/stale-call assertions passing.

- [ ] **Step 4: Record only fresh evidence**

Add feature `F-CONTEXT-PROOFING` to `feature_list.json`, or mark its selected existing feature entry `passing` only after every command above passes. Include exact commands and observed totals/output. Add a session record to `claude-progress.md` with scope behavior, files changed, verification output, and any real-browser work still owed by F-D8.

- [ ] **Step 5: Commit Task 6**

```bash
git add feature_list.json claude-progress.md
git commit -m "docs: record context proofing verification"
```

## Plan Self-Review

- **Spec coverage:** Task 1 implements declared semantic scopes; Task 2 implements depth-limited tree visibility and per-session lease rules; Task 3 enforces those rules through MCP and the existing gate; Task 4 refreshes chat in one reply; Task 5 points driver.js and ghost cursor at the same scope and proves Todo usage; Task 6 runs all required gates and records evidence.
- **No-DOM guarantee:** Tasks 1, 2, and 4 use only `summary()`/scope context messages. Task 5 uses DOM only as a visual anchor.
- **Failure coverage:** Task 2 tests invalid focus, reservation, isolation, depth, replacement, and unmount cleanup. Task 3 proves rejection happens before the handler. Task 4 preserves root after focus failure.
- **Type consistency:** `scopeId` is the full slash-separated scope path throughout React transport, `CapabilityDef`, `ScopeTree`, phases, and target resolution. Focus names consistently use `focus_${scopeId.replaceAll('/', '__')}`.
- **Placeholder scan:** No unresolved placeholders, deferred implementation, or undefined interface references remain in this plan.
