---
phase: implementation
title: Implementation Guide
description: embinder-pointer — what shipped, design deviations, and edge cases handled
---

# Implementation Guide — `embinder-pointer`

## What shipped (files changed)

**`packages/react`**
- `src/use-embinder.ts` (new) — the pointer. Registers through the provider shim on mount (per-mount `AbortController`), returns `{'data-embinder-tool': name}` spread props, unregisters on unmount. Optional `handler` (context-only pointers get `annotations.embinderContextOnly: true`), optional `context()` sampled after every commit → JSON-stable compare → 150 ms debounce → `sendEmbinderContext`, 16 KB truncation with `'[truncated]'` marker + warning. Duplicate mounted names → dev console error (module-scope mount counter). Minimal Zod-shape → JSON Schema converter (the relay only reads `properties.*.type`, `required`, `description`).
- `src/provider.tsx` — shim gained `sendContext` (ws `context {name, state}` message via the same outbox); bubble is now **default-mounted** (`chat?: ChatBubbleConfig | false`, `false` = opt-out and zero bundle); bubble receives `configBase` (relay http base).
- `src/chat/ChatBubble.tsx` — fetches `GET /chat-config` at startup (unless the app overrode `baseURL`+`model`); unconfigured → "connect a model" hint instead of the composer; in-UI baseURL/model inputs removed (config is server-side, D-9).
- `src/index.ts` — exports `useEmbinder`; `grabAnchor` and the `useWebMCP` re-export removed from the public surface.
- `vitest.config.ts` (new), 9 unit tests in `src/use-embinder.test.tsx` (fake-WebSocket harness, `vi.resetModules` per test to reset the module-scope singleton).

**`packages/relay`**
- `src/registry.ts` (new) — `CapabilityRegistry`: capability map with `contextState/contextTs`, grace-timer state machine (default 2000 ms), pending-call tracking with the 30 s timeout moved in from server.ts. Hooks: `onAdd` (session fan-out), `onRemove` (grace expiry → session removal + `cancelByTool`), `onResend` (remount within grace re-delivers unanswered calls).
- `src/server.ts` — registry replaces the bare `toolRegistry` Map + `pending` Map; ws handler gained `context`; `unregister` defers removal to grace expiry; context-only capabilities never registered as MCP tools; `mountChatConfigRoute` wired from `LLM_BASE_URL`/`LLM_MODEL` env.
- `src/chat.ts` — `buildOnScreenBlock` (per-turn "On-screen now" system block, `<embinder:data>`-delimited bound state, labeled as display data); `callableTools` (excludes context-only); tools snapshot at turn start; `mountChatConfigRoute` (D-9).
- `src/approval.ts` — `cancelByTool(tool)` rejects pending approvals with an "unmounted" error.
- `src/gate.ts` — audit approver classification gained the `unmounted` branch (checked before `cancelled`).
- 10 unit tests across `registry.test.ts`, `gate.test.ts`, `chat.test.ts`.

**Demo & harness**
- `apps/todo` — two pages (Board ⇄ Archive) over one store; per-page pointers; context-only `task_board`/`archive_list`; `restore_task` + `purge_archive` (new `PURGE_DONE` action); `list_tasks` deleted; nav is plain buttons (agent navigation is a v1 non-goal, D-8). Seed: 3 open + 2 done.
- `embinder.policy.json` — new capability set (unknown still deny-by-default).
- `scripts/e2e.mjs` — rewritten for the two-page shape; stub LLM now captures request payloads so tests assert the system block and offered tool set; new sections: SC-2 navigation switch (MCP + model views), SC-3 bound state with zero read tools, SC-4 mid-call unmount (rejects at ~2.1 s, not 30 s) and remount-within-grace re-delivery, churn convergence (20 cycles), D-9 `/chat-config`. Relay spawned with `LLM_BASE_URL`/`LLM_MODEL` env. **36 assertions.**
- `README.md`, `BUILD_STATUS.md` — rewritten around the resident-agent thesis; MCP framed as the optional separated-agent path (T4.2).
- Root/workspace `package.json` — `npm test` (vitest) wired.

## Design deviations (all minor, documented)

1. **Context-only pointers DO send a `register` message** (with `annotations.embinderContextOnly: true`) instead of riding only `context` messages as the design sketched. Reason: uniform lifecycle — unregister/grace/fan-out logic works identically for all pointers; the relay simply never exposes them as tools. Design intent (never callable, state in system block) is preserved and e2e-asserted.
2. **Registry entries stay visible during the grace window** (a chat turn started inside the ~2 s window can still see a just-unmounted tool). Accepted edge: calls against it resolve via re-delivery if the capability remounts, or fail with the defined error at expiry.
3. **Re-delivered calls could double-execute** if the old mount answered *after* the app tab dropped the socket message (not observed; the provider deletes its execute entry on abort, so the old mount never answers). Noted for the multi-tab follow-up.
4. **TDD deviation:** the 16 KB truncation guard was written alongside the debounce implementation before its test existed; the test was back-filled and passes.

## Edge cases handled

- StrictMode double-mount: net one live registration, singleton socket survives (test).
- Rapid churn (20× unregister/register): registry converges, no session-tool leaks (e2e).
- Unchanged context snapshots send nothing; unrelated re-renders send nothing (test).
- Approve/deny race with unmount: `cancelByTool` empties the queue entry first; `decide()` on a cancelled id returns `false`; audit shows exactly one outcome per id.
- Broken app socket mid-call: existing `appSocket` error handling unchanged; grace/timeout still settle every pending call.

## Added in dev-testing (2026-07-18)

- `packages/relay/src/server.ts` — loads repo-root `.env` at startup (`process.loadEnvFile`, existing env wins, missing file fine).
- `packages/relay/src/chat.ts` — `normalizeBaseURL` (bare origin → `/v1` API root, applied in `/chat-config` and the provider), allowlist auto-includes the env `LLM_BASE_URL` host (operator config is trusted; browser-supplied hosts still restricted), API key falls back `LLM_KEY` → `OPENAI_API_KEY`.
- `scripts/integration-live.mjs` (new) + `npm run e2e:live` — live integration against the real model (results in the testing doc). Script lessons: gate-pausing turns must be decided *while* the stream is open, and all fetches carry explicit timeouts.
- `packages/react/src/chat/ChatBubble.test.tsx` (new) — hint/composer render tests (jsdom + ResizeObserver stub).
- `.env` added to `.gitignore` (was NOT ignored — key-leak risk closed); `.env` copied into the worktree.

## Follow-ups (not in this feature)

- `docs/DEMO.md` still describes the single-page demo flow — needs a refresh pass.
- `@mcp-b/react-webmcp` is still a dependency of `@embinder/react` (unused by the public surface now) — removable after a native-surface (T-H1) decision.
- Multi-tab `appSocket` binding remains last-connection-wins (pre-existing known gap).
- Agent-driven navigation: v2 headline (requirements non-goal).
