# Todo ⇄ Blackboard Enrichment — Design

> Follow-on to [2026-07-23-worker-agent-llm-handler-design.md](2026-07-23-worker-agent-llm-handler-design.md).
> That spec connected `packages/relay/src/chat.ts` to `packages/worker-agent-sdk` so a Worker
> Agent's handler can be an LLM tool-calling loop. This spec is the first real consumer of that
> capability: every new `apps/todo` board item automatically becomes a Blackboard Task, an LLM
> Worker Agent enriches it (suggests priority/tags/due date/subtasks), and the result flows back
> onto the card live.

## Goal

A user (or an agent) adds a task to the todo board. Without any extra action, that task is
submitted to the sibling `agent-blackboard` system as a Task. A separate Worker Agent process
claims it, runs an LLM tool-calling loop over it (via `defineLLMHandler`, already shipped), and
reports back a suggested `priority`/`tags`/`due`/`subtasks`. The relay observes the completed
Task and pushes the result down the existing WebSocket connection; the card updates live with no
page refresh and no user action beyond the original add.

## Non-goals

- **Not a general Blackboard client for `apps/todo`.** Only one flow is built: add → enrich.
  Manual re-trigger, task deletion sync, or exposing raw Blackboard state in the UI are all out
  of scope.
- **No approval gate on the enrichment path.** Consistent with `defineLLMHandler`'s existing
  no-gate design — this is autonomous background enrichment, not a live-chat action.
- **No persistence across relay restarts.** The relay's in-memory task-tracking map is lost on
  restart; an enrichment already in flight at that moment never delivers its result to the UI
  (documented risk, not engineered around — see Error Handling).
- **No automatic start of `blackboard-server` itself.** It's an external prerequisite the
  developer starts by hand (`cargo run -p blackboard-server` in the sibling `agent-blackboard`
  checkout, or its `docker-compose.yml`) — `npm run dev` never reaches into a sibling repo path.
- **No changes to `worker-agent-sdk`'s public API.** It stays Worker-only. The new Master-side
  calls (`create_task`, project/blackboard bootstrap, listing) live entirely in a new,
  relay-local client — not added to that package, which would reopen its "no internal Embinder
  consumer" non-goal for no reason (nothing about defineLLMHandler needs Master-side calls).

## Architecture

```
packages/relay/src/blackboard-client.ts   NEW — internal-only fetch wrapper against
                                            agent-blackboard's REST API (x-api-key header, same
                                            auth style worker-agent-sdk's own rest-client.ts
                                            already uses): listProjects, createProject,
                                            listBlackboards, createBlackboard, createTask,
                                            listTasks. Not exported from the relay package's
                                            public surface — internal to the relay process only.

packages/relay/src/blackboard-bridge.ts   NEW — the feature's own module, kept separate from
                                            chat.ts (unrelated concern) and registry.ts (no gate
                                            involvement here). Owns:
                                            - bootstrap(): idempotent find-or-create of a
                                              "todo-app" project + blackboard, called once at
                                              relay startup. No-ops if BLACKBOARD_URL is unset.
                                            - mountBlackboardTaskRoute(app): POST
                                              /blackboard-tasks — the browser -> relay entry
                                              point for "a new todo item was added".
                                            - a Map<blackboardTaskId, { todoTaskId: string,
                                              appSocket: WebSocket }> tracking in-flight tasks.
                                            - startPollLoop(): setInterval, 3000ms — lists tasks
                                              on the bootstrapped blackboard, checks each tracked
                                              id's status; on "completed" or "failed", emits the
                                              result to the matching socket and stops tracking it.

packages/relay/src/server.ts              MODIFIED — calls blackboard-bridge's bootstrap() and
                                            startPollLoop() at startup (guarded by
                                            BLACKBOARD_URL), mounts mountBlackboardTaskRoute(app).
                                            The existing emitToApp(type, payload) helper (already
                                            used for intent/gate/decided/focus) is reused as-is
                                            to push results — no new transport.

packages/react/src/provider.tsx           MODIFIED — the ws shim's message handler currently
                                            drops any type outside {intent,gate,decided,focus,
                                            call} (today: `if (m.type !== 'call') return;`).
                                            Add one new case: `type: 'app-event'` -> forwarded,
                                            unmodified, to a new module-level listener set.
                                            New exports: `subscribeEmbinderAppEvent(listener)`,
                                            mirroring the existing `subscribeEmbinderPhase`
                                            pattern exactly (same shape: add/remove a listener,
                                            return an unsubscribe function). @embinder/react
                                            stays domain-agnostic — it forwards `{name, payload}`
                                            without interpreting either field.

apps/todo/src/App.tsx                     MODIFIED — two additions, both fully contained to
                                            this file:
                                            1. A `dispatchAndNotify(action: Action, opts?: {
                                               skipNotify?: boolean }): void` wrapper around the
                                               store's raw `dispatch`: for `ADD_TASK` actions
                                               where `opts?.skipNotify` is not set, fires `POST
                                               /blackboard-tasks` (fire-and-forget, relay origin
                                               from the existing chat-config-style base URL)
                                               before/alongside calling the real dispatch.
                                               `skipNotify` is a plain argument to the wrapper
                                               function itself — NOT a new field on `Action` or
                                               `Task` — so `store.ts`'s reducer and domain types
                                               stay fully untouched, no network-related concept
                                               leaks into pure state code. Passed down wherever
                                               `dispatch` is currently passed.
                                            2. A `useEffect` subscribing via
                                               `subscribeEmbinderAppEvent` for
                                               `name === 'blackboard-enrich-result'`, applying
                                               the payload's suggested fields onto the matching
                                               card via existing actions (`SET_PRIORITY`,
                                               `ADD_TAG` per tag, `SET_DUE`; a `subtasks` result
                                               becomes new sibling cards via `ADD_TASK` — but
                                               those synthetic adds must NOT themselves re-trigger
                                               enrichment, see Data Flow below).

scripts/todo-worker.mjs                   NEW — a standalone Node entry point (tsx, matching
                                            this repo's existing scripts' style):
                                            defineWorkerAgent({ name: 'todo-enrich-worker-1',
                                            capabilities: ['todo-enrich'], baseUrl, apiKey,
                                            blackboardId }).handle('todo-enrich',
                                            defineLLMHandler({ system: ..., tools: {},
                                            resultSchema: z.object({ priority, tags, due,
                                            subtasks }.partial()) })).run({ leaseSeconds: 300,
                                            pollIntervalMs: 2000 }). Reads BLACKBOARD_URL/
                                            BLACKBOARD_API_KEY/BLACKBOARD_ID from env — the same
                                            three the relay resolves at bootstrap and should log
                                            for the worker script to pick up (see Config below).

scripts/dev.mjs                           MODIFIED — adds a third entry to the existing spawn
                                            list (today: relay, todo), following that file's
                                            existing per-process spawn/prefix/color pattern.
                                            Started unconditionally; the worker script itself is
                                            inert (just fails its first list_tasks call, logs a
                                            warning, keeps polling) if BLACKBOARD_URL is unset.
```

## Config

New environment variables, read by both the relay and `scripts/todo-worker.mjs`:

| Var | Default | Purpose |
|---|---|---|
| `BLACKBOARD_URL` | unset (feature off) | `agent-blackboard`'s REST base, e.g. `http://127.0.0.1:8080` |
| `BLACKBOARD_API_KEY` | `dev-key` | Matches the dev key `blackboard-server` logs on local startup with the in-memory adapter |

The relay's `bootstrap()` resolves and logs the created/found `projectId`/`blackboardId` to
stdout at startup (in the same place it already logs the ws port/tokens) so a developer running
`scripts/todo-worker.mjs` by hand can copy them — but since `dev.mjs` spawns the worker itself,
in the normal path the relay's bootstrap result is passed to the worker process via an env var
(`BLACKBOARD_ID`) set once bootstrap resolves, same inter-process handoff style `dev.mjs`
doesn't currently need but is a small, ordinary addition: `dev.mjs` waits for the relay's
bootstrap-done log line before spawning the worker (a simple stdout pattern match, not a new
IPC mechanism), then sets `BLACKBOARD_ID` in the worker's spawned env.

## Data Flow

1. `ADD_TASK` fires (human UI action or an agent's `add_task` tool call — both eventually reach
   the same `dispatchAndNotify` wrapper in `App.tsx`, since the agent tool handler also calls the
   passed-down `dispatch`).
2. `dispatchAndNotify` POSTs `{ todoTaskId, text, priority, tags, due }` to the relay's
   `/blackboard-tasks` — unless called with `{ skipNotify: true }`, which the subtask-creation
   code path (step 6) always passes, preventing an infinite
   enrich-spawns-subtasks-spawns-enrichment loop. This is a caller-side argument, not state
   carried on the `Task`/`Action` themselves (see Architecture).
3. Relay's route handler calls `blackboard-client.ts`'s `createTask({ blackboard_id, capability:
   'todo-enrich', subject: text, input: { text, priority, tags, due } })`, then adds
   `taskId -> { todoTaskId, appSocket: <the requesting session's socket> }` to the tracking map.
4. `scripts/todo-worker.mjs` (already running, started by `dev.mjs`) polls `todo-enrich`,
   claims the task, runs `defineLLMHandler`'s loop (unchanged from last session), calls
   `submit_result` with a schema-validated `{ priority?, tags?, due?, subtasks? }`, which
   `worker.ts` turns into `complete_task`.
5. The relay's 3s poll loop (`blackboard-bridge.ts`) sees the tracked task's status flip to
   `completed`, looks up its map entry, and calls
   `emitToApp('app-event', { name: 'blackboard-enrich-result', todoTaskId, result })` on the
   matching socket, then deletes the map entry. A `failed` status emits
   `{ name: 'blackboard-enrich-failed', todoTaskId, reason }` instead (UI can log/toast; no
   card mutation on failure).
6. `App.tsx`'s subscriber receives it, applies `result.priority`/`result.tags`/`result.due` to
   the existing card via `SET_PRIORITY`/`ADD_TAG`/`SET_DUE` (called through `dispatch` directly —
   these aren't `ADD_TASK`, so `dispatchAndNotify`'s guard doesn't apply to them), and creates
   one new card per `result.subtasks[]` entry via `dispatchAndNotify({ type: 'ADD_TASK', ... },
   { skipNotify: true })` per step 2.

## Error Handling

| Failure | Behavior |
|---|---|
| `BLACKBOARD_URL` unset | Relay skips bootstrap; `/blackboard-tasks` route responds `503` (feature disabled); `dispatchAndNotify`'s POST fails, caught, `console.warn`'d, UI otherwise unaffected. |
| `blackboard-server` unreachable at bootstrap | Relay logs a warning, feature stays off for that process lifetime (no retry loop — a restart is the recovery path, matching this repo's existing "no silent workaround for a real gap" convention). |
| Relay restart mid-enrichment | Tracking map lost; that Task still completes server-side but its result is never observed or pushed. Documented risk, not fixed here (see Non-goals). |
| `todo-worker.mjs` not running | Tasks accumulate as `pending` on the blackboard; no error surfaces in the UI (matches `agent-blackboard`'s own "no push notification, poll-only" reality). |
| LLM/`defineLLMHandler` failure inside the worker | Already handled entirely by last session's work — `fail_task` fires, which this design's poll loop surfaces as `blackboard-enrich-failed`. |
| `POST /blackboard-tasks` succeeds but the socket closes before the result arrives | Poll loop's `emitToApp` is a no-op if the socket isn't open (matches `emitToApp`'s existing guard) — the result is silently dropped, matching the "relay restart" risk above in spirit (session identity isn't durable across reconnects in this design). |

## Testing

- `blackboard-client.ts`: unit tests against an injected `fetch` fake — same tier as
  `worker-agent-sdk`'s `rest-client`/`worker.test.ts` pattern (no real network).
- `blackboard-bridge.ts`: unit tests covering bootstrap's find-or-create idempotency (a second
  bootstrap call against a fake server that already has the project/blackboard must not create
  duplicates), the POST route's task-creation + tracking, and the poll loop's completed/failed
  transitions — all against an injected fetch fake, no real `blackboard-server` needed.
- `provider.tsx`'s new `app-event` case: one focused test alongside its existing ws-shim
  coverage, asserting an unknown-to-the-old-set message type reaches a subscribed listener
  unmodified.
- `App.tsx`'s `dispatchAndNotify`: a test asserting the subtask-loop guard (`ADD_TASK` called
  with `{ skipNotify: true }` does not fire a `/blackboard-tasks` POST, while a plain `ADD_TASK`
  does).
- End-to-end (gated, not run by default): a real `cargo run -p blackboard-server` plus
  `npm run dev`, manually or scripted — add a task, confirm a Task appears via
  `GET /api/v1/tasks`, confirm the card updates once a worker (real or a stubbed LLM endpoint)
  completes it.

## Done Criteria

- Unit suites above green, hermetic (no real network), `npm run typecheck` exit 0 across all
  workspaces including `apps/todo`.
- `npm run dev` starts three processes (relay, todo, todo-worker) without crashing when
  `BLACKBOARD_URL` is unset (feature inert) and when it's set to an unreachable URL (feature
  degrades per the Error Handling table, no crash).
- Manual verification against a real `cargo run -p blackboard-server`: adding a task in the
  browser results in a visible card update (priority/tags/due and/or new subtask cards) without
  a page refresh, evidenced by an actual session transcript/screenshot, not claimed from memory.
- `feature_list.json` is NOT updated for this feature — tracked via this spec + its
  implementation plan only, consistent with `worker-agent-sdk`'s own precedent (that package was
  never added to `feature_list.json` either).
