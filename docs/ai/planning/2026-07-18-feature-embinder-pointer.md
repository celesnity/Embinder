---
phase: planning
title: Project Planning & Task Breakdown
description: embinder-pointer — ordered task plan derived from requirements (SC-1…SC-7), design decisions D1–D8, and testing scenarios
---

# Project Planning & Task Breakdown — `embinder-pointer`

**Final status (2026-07-18, post-review):** All 11 tasks (M1–M4) complete. Verified: 24 unit tests (12 react, 12 relay), hermetic e2e 36 assertions GREEN, live integration vs gpt-5.4-mini 9/9 GREEN, typecheck 0. Review found and fixed one correctness bug (stale handler closure in useEmbinder — now ref-routed and regression-tested). Scope added during dev-testing: relay .env loading, OPENAI_API_KEY fallback, baseURL normalization, env-host allowlisting, live-integration harness. Open follow-ups: dep removal (@mcp-b/react-webmcp), docs/DEMO.md refresh, multi-tab binding, agent navigation (v2). Ready to push.

Traceability: SC-n = requirements success criteria · D-n = design decisions table · test refs = testing doc checkboxes.

## Milestones
**What are the major checkpoints?**

- [x] M1 — Pointer primitive: `useEmbinder` replaces `useWebMCP`+`grabAnchor`; existing e2e green through the new hook (SC-1, SC-7)
- [x] M2 — Runtime semantics: bound-state transport, per-turn tool rebuild, clean unmount failure (SC-3, SC-4)
- [x] M3 — Proof: two-page demo + extended e2e proving the context switch (SC-2, SC-5, SC-6)
- [x] M4 — Repositioning: bubble default-on, MCP demoted to optional, docs/pitch rewritten

## Task Breakdown
**What specific work needs to be done?**

### Phase 1: Pointer primitive (M1)
- [x] T1.1 Implement `packages/react/src/use-embinder.ts` — descriptor type, register-on-mount via provider shim with per-mount `AbortController`, spreadable `EmbinderBind` return, optional `handler` (context-only pointers, D-3), dev-mode duplicate-name error.
  Outcome: one call = declare + anchor + lifecycle. Depends: none. Validation: hook unit tests (SC-1, SC-2 boxes). Tests: Unit/`useEmbinder` 1–2, 5–6.
- [x] T1.2 Provider delta — per-registration abort wiring, keep singleton/StrictMode safety; export `useEmbinder` from `index.ts`; deprecate `grabAnchor` + public `useWebMCP` re-export.
  Outcome: public API is the pointer only. Depends: T1.1. Validation: typecheck + StrictMode unit test. Tests: Unit/`useEmbinder` 3.
- [x] T1.3 Migrate `apps/todo` current page to `useEmbinder` (all 6 tools); remove `grabAnchor` usage.
  Outcome: demo uses only the pointer. Depends: T1.2. Validation: `npm run e2e` green unchanged (17 assertions). Tests: Integration 1.

### Phase 2: Runtime semantics (M2)
- [x] T2.1 Bound state — hook samples `context()` post-commit, JSON-stable compare, 150 ms debounce, 16 KB truncation (D-4); new ws `context {name,state}` message; relay stores `contextState/contextTs` on the registry entry, app-socket-only.
  Outcome: relay always holds a warm snapshot of on-screen state. Depends: T1.1. Validation: unit tests both sides. Tests: Unit/`useEmbinder` 4, 7; Unit/Relay 1.
- [x] T2.2 Chat loop — rebuild tool set from registry at each turn; inject "On-screen now" system block (capabilities + schema summaries + bound state); no synthetic read tools (D-5).
  Outcome: model context is render-scoped by construction. Depends: T2.1. Validation: chat unit tests with stub LLM. Tests: Unit/Chat 1–3.
- [x] T2.3 Unmount semantics — grace-timer state machine on `unregister` (~2 s): re-register within window cancels and in-flight calls proceed; on expiry reject pending forwards with "capability left the screen", cancel pending gate approvals, audit `approver: 'unmounted'` (D-6).
  Outcome: mid-task navigation fails cleanly and quick remounts don't break calls; never the 30 s timeout. Depends: T1.3. Validation: relay unit tests + e2e case. Tests: Unit/Relay 2–4; E2E 3.

### Phase 3: Proof — demo + e2e (M3)
- [x] T3.1 Two-page demo — split `apps/todo` into Board + Archive (manual navigation; agent navigation is a named non-goal, D-8); per-page pointers; context-only `task_board` pointer exposing tasks; seed data per testing doc.
  Outcome: per-page capability sets differ observably. Depends: T1.3, T2.1. Validation: manual smoke + e2e below. Tests: E2E 1–2; Manual 1.
- [x] T3.2 Extend `scripts/e2e.mjs` — page-switch register/unregister assertions, bound-state answer with zero `list_*` tools, unmount-mid-call error, rapid-churn leak check, destructive-approval regression, optional-MCP regression; tag assertions with SC numbers.
  Outcome: the thesis is regression-guarded. Depends: T2.2, T2.3, T3.1. Validation: `npm run e2e` green with grown assertion count. Tests: Integration 2–5; E2E 1–6; Performance 1–2.

### Phase 4: Repositioning (M4)
- [x] T4.1 Bubble default-on in `EmbinderProvider` (opt-out prop) with relay-provided config (D-9): relay serves `GET /chat-config` from env `LLM_BASE_URL`/`LLM_MODEL`; bubble fetches it and shows a "connect a model" hint when unconfigured; relay docs rename to "embedded agent runtime".
  Outcome: resident agent is the default path with zero LLM config in app code. Depends: T2.2. Validation: e2e bubble path incl. unconfigured hint; zero-bundle check when opted out. Tests: E2E 4, 7; Unit/Relay 5.
- [x] T4.2 Demote MCP — keep `/mcp` + `mcp.json` behind "optional separated-agent path" framing (D-7); no code removal.
  Outcome: MCP works, off the pitch. Depends: none (docs + minor flags). Validation: MCP e2e regression. Tests: E2E 5.
- [x] T4.3 Rewrite README/docs around the thesis and one-liner; update `BUILD_STATUS.md`; document `useEmbinder` API and migration from `useWebMCP`/`grabAnchor`.
  Outcome: repo communicates the resident-agent story. Depends: M1–M3 done. Validation: docs review against requirements doc.

## Dependencies
**What needs to happen in what order?**

- Critical path: T1.1 → T1.2 → T1.3 → (T2.1 → T2.2, T2.3) → T3.1 → T3.2 → T4.3.
- T4.1/T4.2 are parallel-safe after Phase 2.
- External: none new — stack unchanged; stub LLM keeps e2e hermetic.
- Every testing-doc scenario maps to a task above (verified: Unit→T1.1/T1.2/T2.1–T2.3, Integration→T1.3/T3.2, E2E→T3.1/T3.2/T4.1/T4.2, Manual/Perf→T3.1/T3.2).

## Timeline & Estimates
**When will things be done?**

- Phase 1: ~1 day (hook is a focused rewrite over existing shim plumbing).
- Phase 2: ~1.5 days (transport + chat-loop changes carry the most unknowns).
- Phase 3: ~1 day (demo split + e2e growth).
- Phase 4: ~0.5 day (mostly docs).
- Buffer: +1 day for churn/StrictMode edge cases surfaced by e2e.

## Risks & Mitigation
**What could go wrong?**

- **Registration-order regression** (provider installs shim at render; hook must read it after) → keep the module-singleton install-at-render invariant; StrictMode unit test first (tdd on T1.1).
- **Context flooding / oversized snapshots** → debounce + 16 KB cap designed in (D-4); perf checkboxes gate merge.
- **Pending-approval cancellation races** (approve arrives as unregister lands) → single-threaded relay event handling; audit line asserts exactly one outcome per id.
- **Mid-turn tool mutation in the `ai` SDK loop** → tools rebuilt only at turn start by design; e2e asserts no mid-turn appearance.
- **MCP client behavior under churn** (listChanged handling varies) → optional path; regression limited to our own e2e client.

## Resources Needed
**What do we need to succeed?**

- Existing stack only (React 18, express 5, ws 8, zod 3, `ai` SDK, MCP SDK 1.29).
- Stub LLM in e2e (already present) for deterministic chat-loop tests.
- Knowledge refs: `docs/ai/requirements|design|testing/2026-07-18-feature-embinder-pointer.md`, ai-devkit memory entry "Embinder v1 thesis and core decisions".
