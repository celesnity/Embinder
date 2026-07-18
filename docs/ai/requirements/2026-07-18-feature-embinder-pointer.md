---
phase: requirements
title: Requirements & Problem Understanding
description: embinder-pointer — the useEmbinder primitive, render-scoped agent context, and resident-agent repositioning
---

# Requirements & Problem Understanding — `embinder-pointer`

## Problem Statement
**What problem are we solving?**

- **Context bloat in agent-on-app systems.** Every existing approach hands the agent the app's entire capability catalog ("here are all 300 tools"). Tool-selection accuracy degrades with tool count, cost and latency grow, and ecosystems respond with remedial layers (tool search, tool filtering) on top of a flat catalog.
- **The connector framing.** MCP-style integrations wire a *separated* agent to the app over a protocol. The agent is a peer system, not a participant — it has no notion of what the user is currently looking at.
- **Who is affected:** app developers who want to make an existing platform AI-native without re-architecting it, and end users who want an in-app assistant that behaves like a competent user of the visible screen.
- **Current state of this repo:** declaration (`useWebMCP`) and element anchoring (`grabAnchor`) are two separate APIs; the anchor is display-only; "context" means tool descriptors only (reading state requires hand-written `list_*` tools); the MCP endpoint is the front door and the resident chat bubble is an off-by-default extra. The mount/unmount tool lifecycle exists but is undemonstrated (single-page demo).

## Goals & Objectives
**What do we want to achieve?**

Thesis: **Embinder makes an agent a resident of the app.** One primitive — the `embinder` pointer — attached to a UI element gives the agent *legibility* (the element and its function enter live context while rendered) and *actionability* (the agent calls the real handler, not pixels). The agent's awareness tracks the display, like a user's does.

Primary goals:
1. **One pointer primitive.** A single spreadable hook `useEmbinder({ name, description, input, handler, context })` that, in one call: registers the capability on mount, anchors it to the element via returned spread props, and unregisters on unmount. Replaces the `useWebMCP` + `grabAnchor` split.
2. **Render-scoped context.** A capability is in the agent's context while its component is mounted on the current page. Navigation unloads it; the new screen's capabilities load in. The agent only ever holds the handful of actions currently in front of the user.
3. **Legibility = capabilities + bound state.** The optional `context` field exposes live, read-only state (e.g. the current task list) to the agent while the element is mounted — "sees what the user sees" is literal, with no hand-written read tools.
4. **Resident agent is the product.** The in-app chat bubble backed by the relay-hosted LLM loop becomes the default path; the relay is repositioned as the *embedded agent runtime* (LLM loop + policy gate + approvals), not a tool server.
5. **Prove the context switch.** A multi-page demo where the user navigates and the agent's live context visibly shrinks/reloads per screen.

Secondary goals:
- Keep the policy gate, approval surface, audit, and spotlight intact — a resident agent operating real handlers makes them more necessary, not less.
- Keep the MCP endpoint (`/mcp`, `mcp.json`) working as an **optional** path for teams that deliberately want a separated agent.

Non-goals (explicitly out of scope for v1):
- **Agent-driven navigation.** V1 agents act only on the current screen; the user navigates manually. (Deferred; natural v2 headline. Nav-elements-as-pointers was evaluated and deferred.)
- **Strict viewport visibility** (IntersectionObserver-based scoping). Render/mount scoping is v1; a "currently visible" metadata hint is a possible later refinement.
- MCP-first positioning or feature growth on the MCP path.
- Non-React framework adapters (Vue/Svelte/vanilla).

## User Stories & Use Cases
**How will users interact with the solution?**

- As an **app developer**, I want to attach one pointer to a button in my existing component so that the agent can see and operate that control while it's on screen — one line, no separate tool server or manifest.
- As an **app developer**, I want to expose the state a screen displays via the same pointer so that the agent reads what the user reads without me writing `list_*` tools.
- As an **end user**, I want to ask the in-app bubble to act on what I'm looking at ("mark the milk task done") so that the agent behaves like a helpful user of this screen.
- As an **end user**, I want the agent's awareness to follow me when I change pages so that it never acts on (or gets confused by) controls that aren't in front of me.
- As a **platform owner**, I want destructive actions to pause on human approval with an audit trail so that a resident agent stays governable.
- As an **external-agent user (optional path)**, I want to point an MCP client at the relay so that a separated agent can drive the same capabilities through the same gate.

Key workflows:
1. Dev wraps app in `EmbinderProvider`, adds `useEmbinder` to controls, spreads the returned props. Runs relay + app.
2. User opens the bubble, asks for an action on the visible screen; agent selects from only the on-screen capabilities and invokes the real handler; destructive calls pause on `/approve`.
3. User navigates; registrations for the previous screen drop; the new screen's registrations (and bound state) load; the agent's next turn reflects only the new screen.

Edge cases to consider:
- Screen change while a call is in flight (tool unmounts mid-task) → the call must fail cleanly with a defined error; the agent loop re-reads the new capability set.
- Two mounted elements attempting the same capability `name` (duplicate registration).
- Rapid navigation (register/unregister churn) — relay and live sessions must not leak or crash.
- Bound `context` state updating at high frequency (typing) — transport must not flood the wire.
- StrictMode double-mount and the module-scope singleton shim.

## Success Criteria
**How will we know when we're done?**

1. **One-line pointer:** each demo control is agent-enabled by a single `useEmbinder` call + prop spread; `grabAnchor` and direct `useWebMCP` usage are gone from the demo app.
2. **Context switch proven:** in a two-plus-page demo, an automated test asserts the capability set exposed to the agent differs per page and changes on (user) navigation — register on mount, unregister on unmount, fan-out to live sessions.
3. **Bound state proven:** the agent answers a question about on-screen data (e.g. current tasks) without any `list_*` tool being defined.
4. **Clean mid-task failure:** a call issued against a capability whose component unmounted returns a defined error (not a 30s timeout), and the next agent turn sees the new capability set.
5. **Resident default:** the chat bubble path works end-to-end through the same gate (existing e2e stays green, extended for the above); MCP path still passes behind its optional posture.
6. **Governance intact:** destructive calls still pause on approval; audit lines still written; approval canonical-bytes behavior unchanged.
7. `npm run typecheck` and `npm run e2e` green across workspaces.

## Constraints & Assumptions
**What limitations do we need to work within?**

Technical constraints:
- React 18+ / Vite app model; the pointer is a React hook (rules of hooks apply — capabilities per component, not per list item, unless keyed child components are used).
- Agent-facing handlers take structured args validated by schema (Zod raw shape), not DOM events — the pointer binds an agent-callable function, not the literal `onClick`.
- Existing relay wire protocol (`register`/`unregister`/`call`/`result` over ws, single `appSocket`) is the substrate; additions must stay backward compatible with the e2e harness.
- Relay remains loopback-only with token + Origin/Host allowlist; the gate remains server-side.

Assumptions (accepted):
- Single app tab per relay session (known `appSocket` last-connection-wins limitation carries over; multi-tab is out of scope).
- "Page" in v1 maps to React mount boundaries (routes, conditional rendering) — no router integration required.
- The `@mcp-b/react-webmcp` dependency may be retained internally or replaced; the public API no longer exposes it.

## Questions & Open Items
**What do we still need to clarify?**

All resolved in design review (2026-07-18) — see design doc decisions table:
1. **In-flight call semantics on unmount** → ~2 s grace period, then defined rejection + approval cancellation (D-6).
2. **Bound-state transport** → push-on-change, debounced, presented as a per-turn "On-screen now" system block, not synthetic tools (D-4, D-5).
3. **Context-only pointers** (no `handler`) → allowed in v1.
4. **Bubble default-on config** (gap found in design review) → relay-provided via `GET /chat-config` from env (D-9).

Resolved in requirements session (2026-07-18): scope rule = render-scoped; API = one spreadable hook; legibility = capabilities + bound state; MCP = optional separated-agent path; navigation deferred past v1.

No open items remain.
