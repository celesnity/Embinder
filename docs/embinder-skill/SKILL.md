---
name: embinder
description: Integrate the Embinder WebMCP SDK into an existing product and make its browser experience AI-native. Use when a coding agent must inspect any web application or platform, inventory every page and user-facing function, expose real actions and live context through Embinder, add the resident agent, cursor, spotlight, policy gate, and approvals, then repeatedly test the complete product in a real browser until every reachable function and animation works or an explicit access-right blocker is documented.
---

# Implement Embinder in a product

Treat integration as product work, not SDK installation. Do not declare completion because the
chat bubble renders, tools register, or unit tests pass. Completion means the agent can understand
and operate the product's reachable browser experience, and the result has been proven in the real
application.

## Complete the mandatory reading gate

Before planning or editing an SDK integration, the coding agent performing the work must personally
read every file below completely, even when one path appears unrelated to the detected framework:

1. This `SKILL.md` through EOF.
2. `references/platform-playbook.md` through EOF.
3. `references/architecture.md` through EOF.
4. `references/integration.md` through EOF.
5. `references/embinder-bridge.js` through EOF.
6. The target product's repository instructions, developer documentation, setup instructions, route
   definitions, permissions model, framework conventions, and test instructions.

Do not delegate this reading to a subagent. If a tool truncates a file, continue until EOF. Do not
make implementation edits before completing the gate. If one of these documents changes during the
task, reread the changed document before continuing.

In the first progress update, explicitly list the Embinder and target documents read, state the stack
verdict and selected integration path, and name the capability-matrix artifact that will define
coverage. This acknowledgement is part of the implementation evidence.

Use `references/integration.md` for the React implementation and reuse
`references/embinder-bridge.js` for Vue, Svelte, Angular, Solid, vanilla JavaScript, or
client-hydrated SSR. Do not rewrite a smaller bridge from memory. Run
`node --no-warnings scripts/validate-bridge.mjs` from this skill directory after changing or copying
the framework-neutral bridge.

## Non-negotiable architecture

- Keep each action handler in the product's browser runtime. Send only its tool descriptor over the
  relay WebSocket.
- Call existing product actions, stores, services, mutations, routers, or SDK clients. Do not build a
  parallel implementation that can drift from the human UI.
- Register tools only where their actions are valid. Unregister them when their page, modal, selected
  resource, or authenticated role leaves scope.
- Send live, bounded page context. Also provide a callable read tool for critical information such as
  schemas or current selection so a late context snapshot cannot strand the agent.
- Classify every tool in `embinder.policy.json`. The server policy is authoritative.
- Route built-in chat and external MCP calls through the same `runGatedCall` path.
- Use the relay's inline Approve/Deny gate for destructive actions. Navigation and inspection must
  not be labelled destructive merely because they cross a page or module boundary.
- Treat embedded iframes and microfrontends as separate browser surfaces. Keep their sandbox in
  place; expose explicit actions and context through a validated host proxy rather than scraping
  their DOM or giving the iframe direct relay credentials.
- Reuse the official mascot, ghost cursor, spotlight, and phase behavior. Do not substitute a static
  icon or a weaker imitation.

## Mandatory implementation process

### 1. Establish the baseline

1. Read repository instructions and product docs.
2. Run the existing install, typecheck, unit, integration, and end-to-end checks.
3. Record pre-existing failures separately. Never hide them inside the Embinder changes.
4. Identify the real command that starts the target product and the URL users actually open.

### 2. Decide whether the SDK can drive the target

Confirm a live browser DOM, client JavaScript, and a permitted WebSocket connection to the relay.
For native mobile, desktop-only, CLI, backend-only, or sandboxed surfaces with no reachable browser
runtime, stop pretending the WebMCP SDK applies. Integrate a web surface if one exists; otherwise
record the boundary in the final rights table.

### 3. Inventory the complete product before wiring

Produce a capability matrix from source code and visible UI. Inspect route declarations, navigation,
pages, nested tabs, dialogs, menus, forms, keyboard actions, store/service methods, API clients,
permission checks, and authenticated roles.

List every meaningful function and sub-function. Include read, search, filter, sort, pagination,
navigate, open, create, edit, submit, upload, download, import, export, approve, delete, restore,
bulk, and settings actions where present. Mark conditional functions by role and UI state.

Do not start broad implementation until the matrix contains:

| Page/state | Human function | Existing code path | Inputs/result | Required context | DOM anchor | Role/right | Planned tool | Test |
|---|---|---|---|---|---|---|---|---|

The denominator in this matrix is the definition of coverage. New functions discovered later must be
added; never silently change the denominator.

### 4. Design the agent surface

For every row, choose one of:

- a callable tool that invokes the real action;
- bounded live context that lets the agent understand the current state;
- both, when state is important and must also be refreshable on demand;
- a documented blocker with evidence and a concrete remediation.

Add navigation coverage for every reachable page. Tool descriptions must say where the action is
valid, what it changes, and which identifiers or prerequisites it needs. Schemas must represent real
required fields and constraints rather than a generic object when the product knows the schema.

For every supported browser platform, implement the same contract: page inventory, navigation,
live current-screen context, callable actions, policy classification, anchors where the owning DOM
is reachable, unregister/reconnect lifecycle, and real-browser proof. Framework support is complete
only when each adapter implements this contract; a bubble alone is not an integration.

### 5. Implement the transport and lifecycle

1. Install the provider or framework-neutral bridge exactly once at the client entry.
2. Fetch the app token, connect the WebSocket, and replay registrations before context snapshots.
3. Expose connection state. Do not enable chat until both the model configuration and bridge are
   ready.
4. Reconnect with bounded backoff and replay current tools/context after reconnect.
5. Dispatch every phase to the visual layer. A `call` phase must also continue into handler execution;
   never return after animation and swallow the action.
6. Return a small structured result or an explicit error for every call.
7. Keep live handlers free of stale closures.
8. For a sandboxed iframe or microfrontend, make the host own relay registration and policy. The
   child may publish bounded context and explicit action descriptors over a typed `postMessage`
   contract; the host validates `event.source`, forwards a scoped action call, and tears it down on
   iframe reload or unmount.

### 6. Implement every capability

Work page by page through the matrix. For each action:

1. Register a stable, verb-led tool name.
2. Define exact inputs, descriptions, and annotations.
3. Call the existing product function with live state and authenticated clients.
4. Anchor the owning DOM element with `data-embinder-tool="<tool>"`.
5. Refresh visible data after mutations when the product does not already do so.
6. Register the authoritative policy risk.
7. Add a focused test before moving to the next action.

Do not replace unsupported functions with fabricated success. Report what is missing.

### 7. Mount the complete resident-agent experience

Verify all sub-systems, not only chat:

- model configuration and streaming chat;
- active capability and context discovery;
- real tool execution and returned results;
- navigation and page-scoped registration;
- mascot launcher, empty state, and resident panel;
- ghost cursor idle motion, trail, target glide, and click reaction;
- spotlight targeting and destructive waiting state;
- approval, denial, audit, timeout, reconnect, and error states;
- reduced-motion and responsive behavior.

### 8. Test the real product, then loop

Run static and headless checks first, but finish in the actual browser and backend. Use an authenticated
test account with the roles in the matrix.

For every matrix row:

1. Navigate there through the agent when navigation exists.
2. Ask the resident agent to inspect the current page.
3. Invoke the tool with valid data.
4. Verify the visible UI and persisted backend state, including after refresh.
5. Exercise invalid input and denied rights.
6. For destructive actions, prove both deny-without-mutation and approve-with-mutation.
7. Observe the cursor and spotlight at the correct element throughout the call.
8. Record pass/fail evidence in the matrix.

Also test cold start, delayed relay start, bridge reconnect, route changes, login/logout, role changes,
and the product's real CSP/CORS/origin headers. A direct WebSocket handshake is not browser proof;
verify from the served page.

When anything fails: diagnose, patch, rerun the smallest relevant test, rerun the affected browser
flow, then rerun the full matrix. Continue until every non-blocked row passes. Do not stop at “mostly
working,” and do not ask the user to perform checks the coding agent can perform safely itself.

### 9. Apply the completion gate

Mark the implementation complete only when all are true:

- Every reachable page and function is listed in the capability matrix.
- Every non-blocked matrix row passes through the resident agent in the real product.
- The agent knows where functions live and can navigate to their valid pages/states.
- All agent sub-systems listed in Stage 7 work on the target platform.
- Animations remain smooth, correctly anchored, responsive, and reduced-motion safe.
- Context is current, callable where critical, and survives reconnect.
- Read/write/destructive policy behavior is proven, including approval and denial.
- Build, typecheck, existing tests, Embinder tests, and real-browser tests pass.
- The final rights table is present, even when it contains only resolved items or “none blocked.”

If any criterion is unverified, the status is **incomplete**. If a criterion cannot pass because of an
external right, policy, platform, or ownership boundary, the status is **blocked**, with the exact row
in the rights table.

## Required final report

Return these artifacts:

1. Stack verdict and actual run URL.
2. Capability coverage summary (`passed / total`, plus blocked count).
3. Pages and functions implemented.
4. Agent sub-system verification results.
5. Commands and browser flows run.
6. Remaining risks or unsupported surfaces.
7. Access-rights table:

| Layer/resource | Required right or allowance | Status | Evidence | Product impact | Exact remediation/owner |
|---|---|---|---|---|---|

Include browser CSP/WebSocket, relay origin/CORS, authentication, application roles, API/collection
rules, filesystem/network sandboxing, iframe restrictions, and server-only boundaries when relevant.
Never say “permissions issue” without naming the blocked resource, denied operation, observed error,
and the party or configuration that can fix it.
