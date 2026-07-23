# Worker Agent LLM Handler — Design

> Follow-on to [2026-07-23-worker-agent-sdk-design.md](2026-07-23-worker-agent-sdk-design.md).
> That spec built `worker-agent-sdk`'s Task lifecycle (register/list/claim/complete/fail) as an
> explicitly Embinder-independent package. This spec reverses that isolation on purpose: it
> connects `packages/relay/src/chat.ts` (Embinder's human-gated, browser-driven chat loop) to
> `packages/worker-agent-sdk` (the headless, gate-free Task poller), so a Worker Agent's
> `.handle()` can be an LLM tool-calling loop instead of hand-written logic.

## Goal

Let a `worker-agent-sdk` consumer write:

```ts
worker.handle('diagnostics', defineLLMHandler({
  system: 'You are a diagnostics agent...',
  tools: { runCheck: tool({ ... }) },
  resultSchema: z.object({ diagnosis: z.string(), severity: z.enum(['low', 'high']) }),
}));
```

instead of hand-rolling an LLM call inside the handler. The claimed Task's input becomes the
prompt; the LLM drives a tool-calling loop over a statically-declared toolset; a required
`submit_result` tool call becomes the value passed to `complete_task({ result })`.

## Non-goals

- **No approval gate for worker actions.** Embinder's human-in-the-loop gate
  (`runGatedCall` in `packages/relay/src/registry.ts`) stays a live-chat-only concept. A
  worker's LLM tool loop executes fully autonomously — the trust boundary is task
  registration/claiming, not a live approver. This was confirmed explicitly and reverses an
  earlier draft of this spec that considered an async approval step.
- **No `create_task` / Master Agent SDK.** Unchanged from the parent spec — still worker-only.
  Dispatching tasks *from* chat.ts (chat as a Task producer) is out of scope here.
- **No dynamic/on-screen tool discovery for workers.** A worker has no browser session and no
  `CapabilityRegistry`. Its tools are a static set the developer declares in
  `defineLLMHandler({ tools })`, not derived from any live UI state.
- **No second agent-loop implementation.** There is exactly one function in the repo that
  constructs an LLM provider and runs a tool-calling loop (`runAgentLoop`, below). Both the
  browser chat route and the worker handler call it — neither hand-rolls its own copy.

## Architecture

```
packages/relay/src/chat.ts
  runAgentLoop(params)            NEW — the single provider-construction + tool-loop primitive,
                                    built on `streamText`. Returns a StreamTextResult: callers
                                    either pipe `.stream` (browser SSE) or await its final-result
                                    accessors (`.toolCalls`, `.text`) after `.consumeStream()`
                                    (worker, programmatic use).
  mountChatRoute(app, deps)        REFACTORED (not duplicated) to call runAgentLoop and pipe
                                    `result.stream` — its previous inline `streamText`/provider
                                    setup is deleted, not kept as a second copy.

packages/worker-agent-sdk/src/
  llm-handler.ts                  NEW — defineLLMHandler(), calls the imported runAgentLoop,
                                    injects a `submit_result` tool, resolves/rejects into the
                                    return-value/throw contract worker.ts's poll loop already
                                    maps to complete_task/fail_task.
  worker.ts                       UNCHANGED — the poll loop's handler contract already supports
                                    this; no core changes needed.
  index.ts                        Adds `export { defineLLMHandler } from './llm-handler.js'`.
```

`worker-agent-sdk` depends on `@embinder/relay` directly (`workspace:*`), per explicit decision —
the alternative (a new shared package, or worker-agent-sdk forking its own copy of the AI SDK
tool-loop pattern) was considered and rejected in favor of one canonical implementation.
`@embinder/relay/package.json` gains an `exports` map entry (it currently only declares `main`)
so `runAgentLoop` is importable as `@embinder/relay/chat` from outside the package.

## `runAgentLoop`

```ts
export interface RunAgentLoopParams {
  baseURL: string;
  model: string;
  apiKey?: string;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, Tool>;
  stopWhen?: StopCondition<any>;   // default: stepCountIs(6), same threshold chat.ts uses today
  prepareStep?: PrepareStepFn;     // mountChatRoute passes its per-turn registry re-scan here;
                                    // defineLLMHandler omits it (worker toolset never changes
                                    // mid-task) and the default is a no-op.
}

export function runAgentLoop(params: RunAgentLoopParams): StreamTextResult<...>
```

Internally: builds the `createOpenAICompatible` provider (identical construction to today's
inline code in `mountChatRoute`) and calls `streamText({ model, system, messages, tools,
stopWhen, prepareStep })`. This is the only call site for both provider construction and
tool-loop execution in the repo.

`mountChatRoute` becomes: call `runAgentLoop(...)`, then
`pipeUIMessageStreamToResponse({ response: res, stream: toUIMessageStream({ stream: result.stream }) })`
— behaviorally identical to today, sourced from the shared function instead of inline code.

## `defineLLMHandler`

```ts
export function defineLLMHandler<TResult>(opts: {
  tools: Record<string, Tool>;
  system: string | ((task: Task) => string);
  resultSchema: ZodType<TResult>;
  stopWhen?: StopCondition<any>;
}): (task: Task, ctx: HandlerCtx) => Promise<TResult>
```

Behavior:

1. Reads `LLM_BASE_URL`/`LLM_MODEL`/`LLM_KEY` (or `OPENAI_API_KEY`) from `process.env` — same
   env-var names and precedence as `mountChatRoute` uses today, per explicit decision (a worker
   process is assumed to run with relay-compatible env; no separate `llmBaseUrl`/`llmModel`
   params on `defineWorkerAgent`).
2. Missing `LLM_BASE_URL`/`LLM_MODEL` → throws immediately (→ `fail_task`, see below).
3. Builds `messages` from the claimed `task.input` (single user-role message, JSON-stringified),
   `system` from `opts.system` (resolved against `task` if a function).
4. Adds one extra tool, `submit_result`, whose input schema is `opts.resultSchema` and whose
   `execute` just returns its own args (it isn't a "real" side-effecting tool — it exists purely
   to force the LLM to emit a schema-validated final answer instead of free text).
5. Calls `runAgentLoop({ ...opts, tools: { ...opts.tools, submit_result } })`, then
   `await result.consumeStream()` followed by `const toolCalls = await result.toolCalls`.
6. Finds the `submit_result` call in `toolCalls`. Found → returns its (already
   `resultSchema`-validated) args. Not found within the step budget → throws
   `Error('LLM did not call submit_result within N steps')`.

`worker.ts`'s existing mapping (handler return value → `complete_task({ result })`; handler throw
→ `fail_task({ reason: error.message })`) requires **no changes** — `defineLLMHandler`'s output is
just a handler function that fits the contract that already exists.

## Error handling

| Failure | Where it surfaces | Result |
|---|---|---|
| `LLM_BASE_URL`/`LLM_MODEL` unset | `defineLLMHandler`, before calling `runAgentLoop` | throw → `fail_task` |
| Upstream LLM/network error | inside `runAgentLoop`'s `streamText` call | throw propagates → `fail_task` |
| LLM never calls `submit_result` in the step budget | `defineLLMHandler`, after `stopWhen` fires | throw → `fail_task` |
| `submit_result` args fail `resultSchema` validation | AI SDK's own tool-input validation (same mechanism chat.ts's tools already use) | throw → `fail_task` |
| `403`/`409` on `claim_task` | unchanged — handled entirely inside `worker.ts`'s existing poll loop, before a handler ever runs | unchanged (parent spec's Decisions table) |

No new error type. No approval-pending state — confirmed non-goal.

## Testing

- **`chat.test.ts`**: new cases for `runAgentLoop` against an injected `fetch` (AI SDK's
  `createOpenAICompatible` accepts a `fetch` override), hermetic, same tier as existing tests.
  Plus a regression case confirming `mountChatRoute`'s piped-stream behavior is unchanged after
  the refactor (existing route tests should still pass verbatim).
- **`packages/worker-agent-sdk/src/llm-handler.test.ts`** (new): injected-`fetch` pattern mirroring
  `worker.test.ts`'s injected-`fetch` fake for the REST client. Cases: happy path (`submit_result`
  called → resolved value matches `resultSchema`), no `submit_result` called within budget →
  throws, upstream fetch error → throws, missing env config → throws before any network call.
- `worker.integration.test.ts`'s existing gated real-server tier is untouched; an
  `llm-handler`-specific integration case (real `blackboard-server` + real/local LLM endpoint) is
  a candidate follow-up, not required for this spec's done criteria.

## Done criteria

- `runAgentLoop` is the only function in the repo that constructs an LLM provider and runs a
  tool-calling loop — grep confirms no second `createOpenAICompatible`/`streamText`/`generateText`
  call site outside `chat.ts`.
- `mountChatRoute`'s existing behavior (verified by its current test suite, unchanged assertions)
  still passes after the refactor.
- `chat.test.ts` new `runAgentLoop` cases green, no external network dependency.
- `llm-handler.test.ts` green, no external network dependency.
- Whole-repo `npm run typecheck` and `npm run test` stay green across all three workspace
  packages (`@embinder/react`, `@embinder/relay`, `@minder/worker-agent-sdk`), confirming no
  regression to the existing live-chat path.
