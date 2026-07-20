# Universal Embinder implementation playbook

Use this worksheet when a coding agent integrates Embinder into another product. The target may use
React, Vue, Svelte, Angular, Solid, vanilla JavaScript, or client-hydrated SSR. The process is
framework-independent; only the client entry, state access, and lifecycle bindings differ.

“Any application” is an implementation process, not a false transport claim. Embinder WebMCP needs a
browser page with a live DOM, JavaScript, and access to the relay WebSocket. For native, CLI,
backend-only, sandboxed, or server-rendered-only surfaces, find a browser surface or report the hard
boundary in the final rights table.

## Contents

1. Baseline and target gate
2. Stack verdict and product map
3. Complete function inventory
4. Capability design
5. Framework adaptation
6. Transport, context, and readiness
7. Visual and resident-agent integration
8. Policy and rights
9. Test matrix and iteration loop
10. Completion and final report

## 1. Baseline and target gate

Before editing:

1. Read repository instructions, startup docs, environment examples, route configuration,
   authentication docs, role/permission rules, and test commands.
2. Run the target's existing checks and start it using its documented command.
3. Record its actual user URL, backend URL, and authenticated test role.
4. Verify the target page has a live DOM and JavaScript.
5. Inspect the served `Content-Security-Policy`, especially `connect-src`.
6. Confirm the page's exact Origin can call relay HTTP endpoints and open
   `ws://127.0.0.1:7331/app`.
7. Record baseline failures without “fixing” unrelated user work.

Do not infer browser connectivity from a Node WebSocket test. The page may still be blocked by CSP,
CORS, iframe sandboxing, mixed-content rules, authentication, or an origin allowlist.

**Artifact — target gate:**

| Requirement | Result | Evidence/remediation |
|---|---|---|
| Browser DOM + client JavaScript | pass/fail | entry file or blocker |
| Relay HTTP reachable from served page | pass/fail | `/app-token`, `/chat-config` |
| Relay WebSocket reachable from served page | pass/fail | browser status/log |
| Origin and CORS allowed | pass/fail | exact Origin/header |
| CSP `connect-src` permits `ws://` | pass/fail | served response header |
| Authenticated test role available | pass/fail | role, never credentials |

## 2. Stack verdict and product map

Read, do not guess:

- package manifests and lockfiles;
- build and SSR configuration;
- client entry and hydration entry;
- router and route guards;
- stores, reducers, signals, services, API/SDK clients;
- authentication bootstrap and permission checks;
- page, dialog, menu, form, table, editor, upload, and download components;
- tests that demonstrate intended behavior.

**Artifact — stack verdict:** one sentence naming framework, language, rendering mode, client entry,
router, state mechanism, and real startup command.

**Artifact — product map:**

| Area | Source of truth | What to capture |
|---|---|---|
| Client entry | mount/hydration file | install bridge/provider once |
| Routes | router definitions | every page, params, guards, nested routes |
| State | store/reducer/service | live state access, no stale closures |
| Actions | handlers/mutations/API clients | reusable human UI logic |
| Context | current page/resource/schema | bounded agent worldview |
| UI anchors | buttons/forms/tables/nav | stable DOM ownership |
| Rights | roles/rules/CSP/CORS | prerequisites and blockers |

## 3. Build the complete function inventory

The function list is mandatory and becomes the coverage denominator. Build it from both source and a
visible walk through the product.

For every route and state, inventory:

- navigation, route parameters, tabs, breadcrumbs, deep links;
- list, view, search, filter, sort, group, paginate, refresh;
- open, create, clone, edit, validate, save, submit, cancel;
- select, bulk-select, bulk-update, delete, restore, archive;
- upload, download, import, export, preview, share;
- modal, drawer, menu, keyboard, drag/drop, canvas actions;
- settings, authentication, impersonation, approval, and role-only functions;
- dynamic functions that exist only after choosing a record or opening a dialog.

Split compound interactions into sub-functions when they have independent inputs, rights, effects,
or tests. “Manage records” is not one function if humans can create, edit, delete, filter, import, and
export separately.

Use this matrix:

| ID | Page/state | Function/sub-function | Existing handler/service | Inputs + constraints | Result/effect | Context needed | Anchor | Required role/right | Tool/context/blocker | Test state |
|---|---|---|---|---|---|---|---|---|---|---|

Rules:

- Include functions the agent cannot yet access.
- Mark role/state conditions explicitly.
- Add newly discovered functions; never erase them to improve the pass rate.
- Keep system/framework internals out unless they are meaningful product actions.
- Review the list against routes, menus, tests, and product documentation before implementation.

## 4. Design the agent capability surface

For every matrix row, choose the smallest reliable representation.

### Callable actions

Create one tool per meaningful action. Use stable verb-led names. The description must state:

- where and when the action is available;
- what it reads or changes;
- required identifiers and prerequisites;
- important restrictions or irreversible effects.

Use accurate schemas. If the product has a runtime schema, expose field names, types, required flags,
enums, ranges, relation requirements, or upload limits. Do not force the agent to invent a generic
`data` object when the product knows more.

### Context and inspection

Send bounded live context for the current route, selected resource, visible schema, result count, and
available next actions. Register the pointer before sending its context snapshot.

Critical information must also be callable. Examples:

- `inspect_current_screen`;
- `describe_active_collection`;
- `get_form_schema`;
- `list_available_routes`.

This prevents a late or missed context snapshot from making the agent ask the user for data already
on screen.

### Navigation and discovery

The agent must know how to reach every page. Provide route metadata in context and callable navigation
for guarded SPA transitions. Page-specific tools must mount only on valid pages/states.

### Results and errors

Return small structured results that include stable identifiers, changed resource, and useful next
state. Throw explicit errors for invalid state, missing rights, unsupported files, or read-only
resources. Never return `{ ok: true }` when nothing changed.

## 5. Adapt to the target framework

### React

Use `EmbinderProvider`, `useWebMCP`, and `grabAnchor`. Read `integration.md`. Install the provider
during the root render so child tool declarations see `document.modelContext`.

### Other browser frameworks

Copy and use `embinder-bridge.js` from this reference folder. It provides registration, context,
phase listeners, reconnect/replay, connection state, local execution, and `document.modelContext`.

| Stack | Install location | Live-state strategy | Lifecycle strategy |
|---|---|---|---|
| Vanilla | module entry | module state / existing store | register on render state, unregister on removal |
| Vue 3 | `main.ts` after mount | Pinia getter / `ref.value` | `watch` + component mount/unmount |
| Svelte | client entry | `get(store)` | component `onMount` cleanup |
| Angular | bootstrap / initializer | injected service | component/service destroy cleanup |
| Solid | root client entry | signal getter | owner cleanup |
| SSR | client-only hydration component | client store | never install during server render |

On the wire, `inputSchema` is JSON Schema:

```js
{
  type: 'object',
  properties: { text: { type: 'string', description: 'Task text' } },
  required: ['text'],
}
```

Do not send a Zod raw shape from a direct-wire client.

## 6. Prove transport, context, and readiness

The resident agent must expose honest states: connecting, ready, working, awaiting approval,
disconnected/retrying, and needs attention.

Implement and test:

1. token fetch;
2. WebSocket connect from the actual served page;
3. registration replay after reconnect;
4. context replay after registrations;
5. page-scoped unregister/remount;
6. tool result/error delivery;
7. bounded reconnect backoff;
8. chat disabled until model config and bridge are both ready.

### Protocol trap that causes “animation but no action”

`call` is both a lifecycle phase and the instruction to execute the browser handler. Phase listeners
must receive it, then dispatch must continue:

```js
if (PHASE_TYPES.has(message.type)) {
  phaseListeners.forEach((listener) => listener(message));
  if (message.type !== 'call') return;
}
// Continue into local handler execution for call.
```

Never put `call` in a phase set and return unconditionally.

### Context ordering trap

If the relay receives context before its capability is registered, it cannot attach the snapshot.
Replay in this order:

1. tool/pointer registrations;
2. current context snapshots;
3. queued tool results.

Refresh context on route, selection, auth, schema, and meaningful data changes.

## 7. Integrate and test the full visual system

The animation system is part of completion.

Use the official Embinder assets and phase behavior:

- resident mascot launcher and agent panel;
- shared ghost cursor with idle wander, trail, target glide, typing/working state, and interaction
  reaction;
- spotlight on the actual owning element;
- awaiting, approved, denied, running, done, and error states;
- responsive positioning and `prefers-reduced-motion` behavior.

For a non-React host, connect `bridge.onPhase(...)` to the shared framework-neutral ghost cursor and
spotlight modules when available. If packaging prevents reuse, fix/export the shared visual module;
do not ship a static icon and call it equivalent.

Every capability needs a stable anchor where a DOM owner exists. For canvas/WebGL actions, anchor the
nearest meaningful DOM container/control and record any precision limitation.

Browser checks:

- cursor exists before opening chat;
- idle movement does not steal pointer events;
- cursor moves to the correct anchor for the called tool;
- spotlight does not highlight an unrelated first row or hidden control;
- approval state locks only the intended action;
- animations do not shift layout, clip, flicker, or cover critical controls;
- reduced-motion users receive a stable non-jarring state;
- route changes and modal teardown remove stale highlights.

## 8. Classify policy and access rights

Add every tool to `embinder.policy.json`:

- `read`: no state mutation;
- `write`: reversible/non-destructive mutation;
- `destructive`: irreversible, dangerous, security-sensitive, or high-impact mutation.

Prove policy with both built-in chat and external MCP where the product supports both. Destructive
tests must demonstrate denial without mutation and approval with exactly one mutation.

Track access rights during implementation. Do not wait until the end to discover them.

Rights categories:

- browser CSP and mixed-content rules;
- relay Host, Origin, and CORS allowlists;
- WebSocket/app token and approver token;
- login/session validity;
- application roles and route guards;
- API, database, collection, row, field, file, and storage rules;
- iframe/sandbox restrictions;
- filesystem, process, network, or container permissions;
- server-only/native boundaries with no client action.

## 9. Execute the test matrix and loop

### Layer A — static

- formatting/lint;
- typecheck/build;
- existing product tests;
- focused adapter and schema tests.

### Layer B — protocol and integration

- register/unregister/reconnect/replay;
- context appears in the agent system block;
- `intent -> gate -> call -> result -> done` executes once;
- read/write/destructive policy, rate limit, audit, approve, deny;
- chat and external MCP use the same capability registry and gate.

### Layer C — real browser and backend

Use the product's real server, served headers, authenticated role, and persisted data. For each matrix
row:

1. navigate to the valid page/state with the agent;
2. inspect current context;
3. call the function;
4. verify visible UI state;
5. verify backend persistence after refresh;
6. verify cursor and spotlight target;
7. verify invalid/denied behavior;
8. record evidence.

### Required resilience scenarios

- cold start with relay already running;
- product starts before relay, then reconnects;
- relay restart while product stays open;
- route, tab, modal, and selected-resource changes;
- login, logout, token expiry, and role differences;
- backend/API error;
- chat model unavailable;
- rapid repeated calls and destructive timeout.

### Loop rule

On failure:

1. capture the exact failing matrix row and layer;
2. diagnose from source, browser state, served headers, logs, and persisted data;
3. fix the smallest root cause;
4. add regression coverage;
5. rerun the focused check;
6. rerun the browser flow;
7. rerun every affected page/function;
8. rerun the full matrix before completion.

Continue until every row passes or has an external blocker with evidence. “The UI looks connected,”
“the cursor moved,” and “the tool appeared” are not proof that the action executed.

## 10. Completion and final report

The integration is complete only when:

- capability inventory covers every reachable page and meaningful human function;
- agent navigation/discovery reaches all valid pages and states;
- every non-blocked action and sub-function passes in the real product;
- all resident-agent sub-systems work;
- all visual phases are smooth and correctly anchored;
- context, reconnect, policy, approval, denial, audit, and persistence are proven;
- no required check is merely delegated to the user.

Return:

### Coverage

| Area | Passed | Blocked | Total | Evidence |
|---|---:|---:|---:|---|

### Function verification

Include the final capability matrix or link to its saved artifact.

### Agent sub-systems

| Sub-system | Result | Evidence |
|---|---|---|
| Connection/readiness/reconnect | pass/fail | |
| Context and inspection | pass/fail | |
| Navigation and page scoping | pass/fail | |
| Action execution/results | pass/fail | |
| Policy/approval/audit | pass/fail | |
| Chat and external MCP | pass/fail | |
| Mascot/cursor/spotlight | pass/fail | |
| Responsive/reduced motion | pass/fail | |

### Access-rights report

Always include this table, even if no rights remain blocked:

| Layer/resource | Required right or allowance | Status | Observed evidence | Product impact | Exact remediation | Owner |
|---|---|---|---|---|---|---|

Use `resolved`, `allowed`, or `blocked`; never use vague “permission issue.” A blocked row must name
the denied operation and the configuration, role, or owner needed to unblock it.

### Final status

Use exactly one:

- **Complete** — every row passes and no completion criterion is unverified.
- **Complete with documented limitations** — all reachable/authorized rows pass and only explicit,
  accepted product limitations remain.
- **Blocked** — external rights or platform boundaries prevent required coverage.
- **Incomplete** — implementation or verification work remains.

Print the selected label exactly as written above, including capitalization.
