# Worker Agent SDK (M5, TypeScript-first) — Design

> **Repo note:** this package wraps the `agent-blackboard` repo's Blackboard Task API (a
> separate, sibling project — Rust, `apps/blackboard-server`). It lives here in `minderSDK`
> (this repo's actual npm workspace, `packages/*`) rather than inside `agent-blackboard` itself,
> per direct instruction — `agent-blackboard` is server-only; TypeScript SDKs belong in this
> repo. Every reference below to `docs/WORKER_AGENT_GUIDE.md`, `apps/blackboard-server/src/...`,
> `e2e/mcp-client/client.py`, `ROADMAP.md`, and `SDK-ROADMAP.md` means the file of that name in
> the sibling `agent-blackboard` repo, not this one — those are the authoritative source for the
> server-side contract this SDK wraps.

## Goal

Give TypeScript developers a declarative wrapper around the Task lifecycle that is already
built and verified server-side in `agent-blackboard` (see that repo's
`docs/superpowers/specs/2026-07-22-task-resource-design.md` and the Docker Compose e2e proof
referenced in `docs/WORKER_AGENT_GUIDE.md`), so writing a Worker Agent means declaring
`capabilities` + a handler function, not hand-rolling HTTP calls, polling, backoff, or the
claim/complete/fail state machine. Per `agent-blackboard`'s `SDK-ROADMAP.md` M5, this is
DX-sugar over an API that already works without it — REST/MCP integration is proven; the SDK
only removes boilerplate.

Consumer: anyone building a specialized agent against `blackboard-server`'s Task resource — no
internal Embinder consumer for this package (unlike `@embinder/react`/`@embinder/relay`, which
this repo's `packages/*` otherwise contains); this is a separate, unrelated product line sharing
this repo only as an npm-workspace host, per direct instruction.

## Non-goals

- **Master Agent SDK** (`create_task`/monitor side) — out of scope. Worker-only.
- **Python SDK** — `agent-blackboard`'s SDK-ROADMAP.md M5 table says "TS trước" (TS first).
- **Generic M2 Client SDK** (projects/blackboards/artifacts/subscriptions resources) —
  `agent-blackboard`'s SDK-ROADMAP.md marks M2 "❔ chưa quyết" and warns against building it
  without ≥2 real consumers. This package implements only the internal REST calls the Worker
  Agent lifecycle needs (`register_agent`, `list_tasks`, `claim_task`, `complete_task`,
  `fail_task`) — not a public, general-purpose Blackboard client.
- **Lease renewal** — `docs/WORKER_AGENT_GUIDE.md` documents this as a real server-side gap, not
  something the SDK can paper over. `leaseSeconds` stays an explicit, required caller decision.
- **Push/SSE-based task delivery** — no push notification for Tasks exists server-side; polling
  is the only mechanism.
- **`worker.stop()` calling a server-side "unregister agent" endpoint** — no such endpoint
  exists yet; `stop()` only halts the client-side poll loop.

## Architecture

```
packages/worker-agent-sdk/        (this repo's npm workspace, @minder/worker-agent-sdk)
  src/
    types.ts                       Task, TaskStatus, AgentIdentity — mirror agent-blackboard's
                                     apps/blackboard-server/src/dto/task.rs
    rest-client.ts                  internal-only fetch wrapper: registerAgent, listTasks,
                                     claimTask, completeTask, failTask. Not part of the
                                     package's public exports.
    errors.ts                       BlackboardApiError (status + message from the server's
                                     {"error": "..."} body — apps/blackboard-server/src/error.rs)
    worker.ts                        defineWorkerAgent(), WorkerAgent.handle(), .run(), .stop()
    index.ts                         public exports
    worker.test.ts                   unit tests against an injected fetch fake — same tier as
                                       this repo's existing packages/relay/src/*.test.ts suites
    worker.integration.test.ts       real HTTP against an already-running blackboard-server, no
                                       mocking, gated on REST_URL/API_KEY (not run by default)
```

Plain npm workspace member under this repo's existing `packages/*` glob (see root
`package.json`) — no relationship to `agent-blackboard`'s Cargo workspace.

## Decisions

| Question | Decision | Reasoning |
|---|---|---|
| Transport: REST or MCP (Streamable HTTP JSON-RPC)? | **REST** (`x-api-key` header, plain JSON) | The Task lifecycle is identical on both transports (agent-blackboard's README.md "Task tools (same set on both transports)"). MCP's Streamable HTTP framing exists so *LLM tool-callers* can drive the blackboard — a TypeScript program is not one. `agent-blackboard`'s SDK-ROADMAP.md "Done" criterion ties correctness to `run_worker()`'s *behavior* (register → discover → claim → complete/fail, 409-not-error / 403-is-error), not its wire protocol. |
| `blackboardId` — the SDK-ROADMAP.md illustrative snippet doesn't show it | **Required config field.** `ListTasksParams.blackboard_id` is non-optional server-side — there is no "search all blackboards" mode. `defineWorkerAgent({ name, capabilities, baseUrl, apiKey, blackboardId })`. | The roadmap snippet is illustrative, not a literal contract; the real DTO is authoritative. |
| Auth: where does `apiKey` live? | Caller passes `apiKey`/`baseUrl` into `defineWorkerAgent()`; the SDK never persists it (no file, no env-reading magic, memory only). | Matches `agent-blackboard`'s M2 decision table verbatim, applied here too. |
| `leaseSeconds` | **Required** field of `run()`, no SDK-side default even though the server defaults to 300s. | `agent-blackboard`'s M5 decision table: "SDK bắt buộc caller tự khai báo... không tự đặt default ngầm." A non-optional TS field enforces that at compile time. |
| `409` on `claim_task` | **Not an error.** Swallowed inside the poll loop; the worker continues to the next tick. | `docs/WORKER_AGENT_GUIDE.md` §"Pool semantics": "not an error worth alerting on." |
| `403` on `claim_task` (capability mismatch) | **Real error.** `onError` callback if provided (continue polling); throw + stop `run()` otherwise. | Guide: a mismatch "shouldn't happen" and signals a config bug — fail loud by default. |
| Multiple `capabilities` | One `list_tasks` call per registered capability, per poll tick. | Mirrors the Worker Agent Guide's own example; avoids client-side filtering of an unfiltered scan. |
| Poll cadence | Fixed `pollIntervalMs` — **no** autonomous backoff in v1. | Matches the documented API shape exactly; backoff is a candidate follow-up, not invented here. |
| Graceful shutdown | `WorkerAgent.stop()` halts the poll loop only; no server call. | Matches the documented "no unregister endpoint" gap. |
| Re-registration on restart | `run()` always calls `register_agent` with the same `name` — never persists `agent_id`. | Relies on server-side upsert-by-`(tenant_id, name)`. |
| Handler result / error mapping | Return value → `complete_task({ result })`. Thrown error → `fail_task({ reason: error.message })`. | Verbatim behavior from the SDK-ROADMAP.md M5 API-shape comment. |

## Public API

```ts
import { defineWorkerAgent } from "@minder/worker-agent-sdk";

const worker = defineWorkerAgent({
  name: "diagnostics-worker-1",
  capabilities: ["diagnostics"],
  baseUrl: "http://localhost:8080",
  apiKey: process.env.BLACKBOARD_API_KEY!,
  blackboardId: process.env.BLACKBOARD_ID!,
});

worker.handle("diagnostics", async (task, ctx) => {
  const diagnosis = await someLlmSdk.chat([...]);
  return diagnosis;               // -> complete_task({ result: diagnosis })
  // throw new Error("...")       // -> fail_task({ reason: error.message })
});

const running = worker.run({
  leaseSeconds: 300,
  pollIntervalMs: 2000,
  onError: (err) => console.error(err),
});

worker.stop();
await running;
```

`ctx` exposes `{ agentId, taskId }` only — no `ctx.publish(...)`, which would reach into
generic-client territory this spec deliberately excludes.

## Error handling

`BlackboardApiError extends Error { status: number; body: string }`, thrown for any REST
response outside 2xx except `409` on `claim_task` (swallowed per the Decisions table). Mirrors
`apps/blackboard-server/src/error.rs`'s `{"error": "<message>"}` shape exactly.

## Testing

Two tiers, mirroring this repo's own existing split (`packages/relay`'s fast unit suites vs.
`scripts/e2e.mjs`/`scripts/integration-live.mjs`'s real-process integration runs):

1. **`worker.test.ts`** — pure poll-loop and error-mapping logic against an injected fetch fake.
   Runs in `npm run test`, no external server required.
2. **`worker.integration.test.ts`** — real HTTP against an already-running `blackboard-server`
   (`cargo run -p blackboard-server` in the sibling `agent-blackboard` repo, or
   `docker compose up` there), gated on `REST_URL`/`API_KEY` env vars exactly like
   `e2e/mcp-client/client.py`'s `_require_env`. Bootstraps its own project/blackboard over real
   HTTP, then drives the full `defineWorkerAgent` lifecycle against a real `create_task` call.
   Not run by default — separate `npm run test:integration` script, same "hermetic default,
   explicit live opt-in" split as this repo's own `npm run e2e` vs `npm run e2e:live`.

Key integration cases (mirrors `run_worker()` in `agent-blackboard`'s `e2e/mcp-client/client.py`):

1. Happy path: Master creates a Task via REST → worker discovers, claims, runs handler,
   `complete_task` lands → `GET /tasks/{id}` shows `status: completed`.
2. Handler throws → task ends `status: failed` with the thrown message as `failure_reason`.
3. Claim race: two `WorkerAgent` instances, one Task — exactly one completes it; the loser's
   `409` never surfaces as an error.
4. Capability mismatch → `403` propagates to `onError` if provided, else `run()` rejects.
5. `stop()` mid-run → `run()`'s promise resolves once the in-flight tick finishes.

## Done criteria

- `worker.test.ts` green with no external dependency.
- `worker.integration.test.ts` green against a real `blackboard-server` — evidence must include
  actual command output. If a session cannot reach a live server, the integration tests are
  still checked in real and unmocked, but status stays `in_progress`, not `passing`, until
  someone runs them and records the output.
- `docs/WORKER_AGENT_GUIDE.md` (agent-blackboard repo)'s described lifecycle exactly matches
  this SDK's behavior — no invented behavior, no silently changed documented behavior.
