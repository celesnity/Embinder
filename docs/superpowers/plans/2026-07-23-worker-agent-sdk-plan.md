# Worker Agent SDK Implementation Plan

**Goal:** Ship `packages/worker-agent-sdk` (`@minder/worker-agent-sdk`) implementing
`defineWorkerAgent` / `.handle()` / `.run()` / `.stop()` per the approved spec.

**Full spec:** [docs/superpowers/specs/2026-07-23-worker-agent-sdk-design.md](../specs/2026-07-23-worker-agent-sdk-design.md)

**Tech stack:** TypeScript, native `fetch` (Node 18+, no HTTP client dependency), Vitest — same
stack as this repo's `@embinder/relay`/`@embinder/react` packages.

## Tasks

1. **Package scaffold** — `package.json` (name `@minder/worker-agent-sdk`, extends this repo's
   npm-workspace conventions), `tsconfig.json` (`extends: "../../tsconfig.base.json"`, matching
   `packages/relay`/`packages/react`). No runtime dependencies.
2. **Types + errors** — `src/types.ts` mirrors `agent-blackboard`'s `TaskResponse` DTO
   field-for-field (snake_case preserved); `src/errors.ts`'s `BlackboardApiError` mirrors that
   repo's `{"error": "..."}` shape.
3. **Internal REST client** — `src/rest-client.ts`: `registerAgent`, `listTasks`, `claimTask`
   (returns a discriminated result instead of throwing on `409`/`403` — see spec's Decisions
   table), `completeTask`, `failTask`. Not exported from `index.ts`.
4. **`defineWorkerAgent` / poll loop** — `src/worker.ts`: register once, poll each capability
   with a registered handler, claim → run handler → `complete`/`fail`, `409` silently retried,
   `403` routed to `onError` or thrown, `stop()` cancels the in-flight sleep immediately.
5. **Unit tests** — `src/worker.test.ts` against an injected fetch fake (this repo's existing
   `packages/relay/src/*.test.ts` tier), covering: register-once, one `list_tasks` call per
   capability per tick, success → `complete_task` with the handler's return value, throw →
   `fail_task` with the error message, `409` never throws/never calls `onError`, `403` calls
   `onError` when provided and rethrows+stops when absent, `stop()` resolves `run()` immediately.
6. **Integration tests (real server, gated)** — `src/worker.integration.test.ts`, `REST_URL`/
   `API_KEY` env-gated exactly like `agent-blackboard`'s `e2e/mcp-client/client.py`'s
   `_require_env`; bootstraps its own project/blackboard, exercises the 5 cases from the spec's
   Testing section against a real Task created via REST. Separate `npm run test:integration`
   script, not part of the default `npm run test`.
7. **Docs** — point `agent-blackboard`'s `ROADMAP.md`/`SDK-ROADMAP.md` M5 entries at this
   package's real location (`minderSDK/packages/worker-agent-sdk`, not a folder inside that
   repo), since the SDK's implementation repo is this one.

## Constraints carried over from the spec

- No mocking the thing under test: `worker.test.ts` isolates logic from network I/O via a
  substituted `fetch`, not by mocking `WorkerAgent` itself; `worker.integration.test.ts` uses
  zero fakes.
- `leaseSeconds` stays a required, non-optional field — never silently defaulted at the SDK
  layer even though the server has its own default.
- `blackboardId` is a required config field even though the SDK-ROADMAP.md illustrative snippet
  doesn't show it — the real server DTO requires it.

## Status at time of writing

Tasks 1–6 code-complete and typechecked/tested in-session:
`npm run typecheck -w @minder/worker-agent-sdk` → exit 0;
`npm run test -w @minder/worker-agent-sdk` → 8/8 PASS;
whole-repo `npm run typecheck` and `npm run test` (all 3 workspace packages) → all green,
confirming this addition didn't regress `@embinder/react`/`@embinder/relay`.
`npm run test:integration -w @minder/worker-agent-sdk` has **not** been run against a real
`blackboard-server` — no Rust toolchain available in the session that wrote this code, and the
only compiled `blackboard-server` binary found was macOS arm64 (unrunnable in that session's
Linux sandbox). Task 7 (docs) still owed in the `agent-blackboard` repo.
