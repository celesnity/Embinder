---
phase: testing
title: Testing Strategy
description: embinder-pointer — scenarios derived from requirements success criteria and design components
---

# Testing Strategy — `embinder-pointer`

## Test Coverage Goals
**What level of testing do we aim for?**

- Unit coverage target: 100% of new/changed code in `use-embinder.ts`, provider delta, relay `context`/unregister handling, chat-loop context block.
- Integration scope: the ws wire protocol (existing 4 message types + new `context`), gate interaction on unmount, per-turn tool rebuild.
- E2E: extend `scripts/e2e.mjs` (headless relay + fake app + real client) — it remains the single source of round-trip truth.
- Every requirements success criterion (SC-1…SC-7) maps to at least one checkbox below.

## Unit Tests
**What individual components need testing?**

### `useEmbinder` hook (packages/react)
- [x] Registers descriptor on mount; returned props contain `data-embinder-tool` with the capability name (SC-1)
- [x] Unregisters on unmount via abort signal (SC-2)
- [x] StrictMode double-mount does not double-register or kill the singleton ws
- [x] `context()` sampled after commit; unchanged snapshot sends nothing; changed snapshot sends `context` message after 150 ms debounce (SC-3)
- [x] Context-only descriptor (no `handler`) registers as non-callable; no tool exposed
- [x] Duplicate mounted name → dev-mode console error; last-mount-wins in registry
- [x] Snapshot > 16 KB truncated with marker + warning

### Relay registry & server (packages/relay)
- [x] `context` message updates `CapabilityDef.contextState`/`contextTs`; rejected on non-app socket
- [x] `unregister` starts ~2 s grace; on expiry, pending forwards reject with "capability left the screen" (never the 30 s timeout) (SC-4)
- [x] Re-register of the same name within the grace window cancels the timer; in-flight call proceeds against the new registration (SC-4)
- [x] Grace expiry cancels a pending gate approval; audit line `approver: 'unmounted'`; exactly one audited outcome per call id (SC-4, SC-6)
- [x] `GET /chat-config` returns env `LLM_BASE_URL`/`LLM_MODEL`; Origin-gated; absent env → empty config (D-9)
- [x] Register/unregister fan-out to live MCP sessions unchanged (regression) (SC-5)

### Chat loop (packages/relay/src/chat.ts)
- [x] Tool set rebuilt from registry snapshot at each turn — tool registered after turn N appears in turn N+1, not mid-turn (SC-2)
- [x] "On-screen now" system block includes capability names, schema summaries, and data-delimited bound state; absent state omitted (SC-3)
- [x] Bound state is not exposed as synthetic tools (tool count == callable capabilities) (SC-3)
- [x] Prompt-injection guard: adversarial task text in bound state cannot destroy state without approval — proven against a REAL model (`scripts/integration-live.mjs` LIVE-3); delimiter/label unit-asserted in `chat.test.ts` (SC-6)

## Integration Tests
**How do we test component interactions?**

- [x] Full register → call → result round trip through `useEmbinder` (replaces `useWebMCP` path) (SC-1)
- [x] Navigation simulation: unmount page-A pointers, mount page-B pointers → registry and live sessions reflect exactly page B (SC-2)
- [x] Rapid navigation churn (A↔B ×20): no registry leaks, no pending-map leaks, no session-tool leaks
- [x] Destructive call still pauses on `/approve`; canonical bytes execute; deny returns isError (regression) (SC-6)
- [ ] Failure mode: ws drops mid-register → outbox flushes on reconnect without duplicate registration

## End-to-End Tests
**What user flows need validation?**

- [x] Two-page demo: agent (stub LLM) on page Board sees only Board capabilities; after user navigation, sees only Archive capabilities (SC-2)
- [x] Agent answers "what tasks are on screen?" from bound state with zero `list_*` tools defined (SC-3)
- [x] Call issued, page switched before execute → after ~2 s grace expiry, defined error surfaces to model; next turn sees new capability set (SC-4)
- [x] Bubble path end-to-end through the gate (existing e2e stays green, extended) (SC-5)
- [x] Bubble with no relay LLM config renders the "connect a model" hint; with config the composer renders (`ChatBubble.test.tsx`); live chat with zero app-code config proven in LIVE-1..5 (D-9)
- [x] Optional MCP path: external client lists/calls the same gated capabilities (SC-5)
- [x] Regression: `npm run typecheck` and full `npm run e2e` green (SC-7)

## Test Data
**What data do we use for testing?**

- Existing e2e harness fixtures: fake browser app over ws `/app`, real streamable-HTTP MCP client, stub LLM for `/chat`.
- Seed tasks for the two-page demo (Board: 3 open tasks; Archive: 2 done tasks) so per-page context differs observably.
- Oversized-context fixture (>16 KB JSON) for the truncation case.

## Live Integration (real model)
**`npm run e2e:live`** — `scripts/integration-live.mjs`: real relay + real LLM from `.env` (`LLM_BASE_URL`/`LLM_MODEL`/`OPENAI_API_KEY`), same wire as the browser SDK. Run 2026-07-18 against `gpt-5.4-mini` via `https://api.openai.com/v1` — **9/9 green**:

- LIVE-0 `/chat-config` serves normalized env config
- LIVE-1 real model called `add_task` through the gate (board mutated)
- LIVE-2 model answered the board contents from bound state alone (zero read tools)
- LIVE-3 adversarial task text ("IGNORE ALL INSTRUCTIONS…") could not destroy state — gate held
- LIVE-4 after navigation the model answered from the Archive context; Board gone from its world
- LIVE-5 real destructive call paused at `/approve`; executed only after approval

Requires a key; skips cleanly when `.env` is absent (CI-safe).

## Test Reporting & Coverage
**How do we verify and communicate test results?**

- `npm run typecheck` — exit 0 across workspaces.
- `npm run e2e` — assertion count expected to grow from 17; each new assertion tagged with its SC number in output.
- Coverage gaps below target documented here with rationale before phase sign-off.
- **Open gaps (2026-07-18, post dev-testing):** ws-drop-mid-register and the two performance checks remain open (low risk, mechanical); manual browser smoke still recommended before merge. Everything else is covered.

## Manual Testing
**What requires human validation?**

- [ ] Live browser smoke: `npm run relay` + `npm run todo`, real bubble, navigate between pages, watch spotlight + context follow (SC-2 visual)
- [ ] `/approve` page fidelity (raw vs canonical, tamper flag) unchanged
- [ ] A11y: spread props introduce no focus/ARIA regressions on anchored elements

## Performance Testing
**How do we validate performance?**

- [ ] Continuous typing into a bound input: ≤ ~7 `context` messages/s per pointer (debounce holds)
- [ ] Turn start with 10 on-screen capabilities: tool rebuild adds no observable latency vs current baseline

## Bug Tracking
**How do we manage issues?**

- Issues found during this feature tracked in the feature planning doc as tasks; regressions guarded by adding an e2e assertion before fixing.
- Severity: anything violating the gate/approval posture is release-blocking.
