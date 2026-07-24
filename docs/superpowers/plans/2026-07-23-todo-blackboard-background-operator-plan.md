# Todo Blackboard Background Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let a background worker claim natural-language todo-operate Blackboard tasks, operate the connected Todo browser through existing Embinder tools, and report the outcome to Blackboard.

**Architecture:** The relay exposes token-protected snapshot and call endpoints. The worker converts the current tool snapshot into AI SDK tools; every selected action uses the existing relay-to-browser path and the existing Worker Agent lifecycle records the terminal Blackboard result.

**Tech Stack:** TypeScript, Express, Zod, AI SDK tool, @minder/worker-agent-sdk, Vitest, agent-blackboard REST API.

## Global Constraints

- External agents create Blackboard tasks; Todo does not.
- Blackboard capability is exactly todo-operate; subject and input are natural-language instructions.
- Do not render Blackboard status, controls, logs, or agent diagnostics in apps/todo.
- Never expose browser WebSocket or approval tokens to the worker.
- Existing relay policy remains authoritative, including destructive approval.
- Every claimed Blackboard task ends once as completed or failed.
- Real Blackboard plus browser proof is mandatory before completion.

---

### Task 1: Preserve callable browser schemas in the relay registry

**Files:** Modify packages/relay/src/registry.ts and packages/relay/src/server.ts; test packages/relay/src/registry.test.ts.

**Interfaces:** Add jsonSchema?: unknown to CapabilityDef. Add operatorEntries(): Array<[string, CapabilityDef]> that returns real registered capabilities, excludes context-only pointers, and excludes synthetic focus tools. Persist m.tool.inputSchema as jsonSchema in the browser register handler.

- [ ] **Step 1: Write the failing test**

```ts
it('returns only callable tools with original JSON schemas', () => {
  const registry = new CapabilityRegistry();
  registry.register('add_task', { config: { inputSchema: { text: z.string() } }, destructive: false, jsonSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } });
  registry.register('current_screen', { config: { annotations: { embinderContextOnly: true } }, destructive: false });
  expect(registry.operatorEntries()).toEqual([['add_task', expect.objectContaining({ jsonSchema: expect.any(Object) })]]);
});
```

- [ ] **Step 2: Verify red** — Run npm run test -w @embinder/relay -- registry.test.ts. Expected: operatorEntries is missing.

- [ ] **Step 3: Implement**

```ts
operatorEntries(): Array<[string, CapabilityDef]> {
  return [...this.defs].filter(([, def]) => !def.config.annotations?.embinderContextOnly);
}
// server.ts browser register case
jsonSchema: m.tool.inputSchema,
```

- [ ] **Step 4: Verify green** — Run npm run test -w @embinder/relay -- registry.test.ts && npm run typecheck -w @embinder/relay.

- [ ] **Step 5: Inspect the focused diff** — Run `git diff --check`; do not commit (user-directed).

### Task 2: Add authenticated relay operator endpoints

**Files:** Modify packages/relay/src/server.ts; create packages/relay/src/operator-routes.test.ts.

**Interfaces:** GET /internal/operator/snapshot requires x-embinder-operator-token and returns { tools: Array<{ name, description?, inputSchema, context? }> }. POST /internal/operator/call requires the same header and { name, args, taskId }, returning the existing CallToolResult. EMBINDER_OPERATOR_TOKEN is required. A wrong/missing token returns 401; no app socket returns 503 { error: 'todo_module_unavailable' }.

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects an operator snapshot without the server-only credential', async () => {
  expect((await fetch(`${base}/internal/operator/snapshot`)).status).toBe(401);
});
it('returns module unavailable rather than pretending an action ran', async () => {
  const response = await fetch(`${base}/internal/operator/call`, { method: 'POST', headers: jsonOperatorHeaders, body: JSON.stringify({ name: 'add_task', args: { text: 'milk' }, taskId: 'bb-1' }) });
  expect(response.status).toBe(503);
});
```

- [ ] **Step 2: Verify red** — Run npm run test -w @embinder/relay -- operator-routes.test.ts.

- [ ] **Step 3: Implement**: authenticate with tokenMatches(req.header('x-embinder-operator-token'), OPERATOR_TOKEN); snapshot registry.operatorEntries() with name, description, jsonSchema, and contextState; route calls through runGatedCall(name, args, def.destructive, `operator:${taskId}`, new AbortController().signal). Reject context-only/missing capabilities with 404 todo_capability_unavailable.

- [ ] **Step 4: Verify green** — Run npm run test -w @embinder/relay -- operator-routes.test.ts gate.test.ts.

- [ ] **Step 5: Inspect the focused diff** — Run `git diff --check`; do not commit (user-directed).

### Task 3: Implement a worker-side operator client

**Files:** Create packages/worker-agent-sdk/src/operator-client.ts and operator-client.test.ts; modify packages/worker-agent-sdk/src/index.ts.

**Interfaces:**

```ts
export interface OperatorClientConfig { relayBaseUrl: string; operatorToken: string; }
export interface OperatorSnapshotTool { name: string; description?: string; inputSchema: unknown; context?: unknown; }
export async function getOperatorSnapshot(cfg: OperatorClientConfig): Promise<OperatorSnapshotTool[]>;
export async function callOperatorTool(cfg: OperatorClientConfig, args: { name: string; args: unknown; taskId: string }): Promise<unknown>;
export function operatorTools(cfg: OperatorClientConfig, taskId: string, snapshot: OperatorSnapshotTool[]): ToolSet;
```

- [ ] **Step 1: Write failing tests**: assert getOperatorSnapshot sends x-embinder-operator-token; assert a generated add_task AI SDK tool POSTs taskId, name, and args to /internal/operator/call.

- [ ] **Step 2: Verify red** — Run npm run test -w @minder/worker-agent-sdk -- operator-client.test.ts.

- [ ] **Step 3: Implement**: accept only object JSON schemas; convert string, number/integer, boolean, and array properties into a Zod raw shape; throw todo_capability_unavailable for unsupported/absent schemas. Create each AI SDK tool with tool({ description, inputSchema: z.object(shape), execute }), where execute calls the relay endpoint and throws its JSON error for every non-2xx response.

- [ ] **Step 4: Verify green** — Run npm run test -w @minder/worker-agent-sdk -- operator-client.test.ts && npm run typecheck -w @minder/worker-agent-sdk.

- [ ] **Step 5: Inspect the focused diff** — Run `git diff --check`; do not commit (user-directed).

### Task 4: Replace Todo enrichment worker with Todo operator

**Files:** Modify scripts/todo-worker.mjs; test packages/worker-agent-sdk/src/llm-handler.test.ts.

**Interfaces:** Required worker config is BLACKBOARD_URL, BLACKBOARD_API_KEY, BLACKBOARD_ID, and EMBINDER_OPERATOR_TOKEN. EMBINDER_OPERATOR_BASE_URL defaults to http://127.0.0.1:7331. The worker is named todo-operator-worker-1, handles todo-operate, and completes with { summary: string, actions: string[] }.

- [ ] **Step 1: Write failing test**: capture the LLM request for a todo-operate Task and assert both its subject and JSON input appear in the operator instruction.

- [ ] **Step 2: Verify red** — Run npm run test -w @minder/worker-agent-sdk -- llm-handler.test.ts.

- [ ] **Step 3: Implement**: remove Todo project/blackboard bootstrap and todo-enrich registration. Claim only todo-operate. Before each task, request the operator snapshot; fail with todo_capability_unavailable when it is empty. Invoke defineLLMHandler with operatorTools(config, ctx.taskId, snapshot), system text requiring use of supplied tools only, and z.object({ summary: z.string(), actions: z.array(z.string()).max(10) }).

- [ ] **Step 4: Verify green** — Run npm run test -w @minder/worker-agent-sdk -- llm-handler.test.ts && node --import tsx scripts/todo-worker.mjs. Expected: a missing required configuration produces a specific idle/configuration message and claims no work.

- [ ] **Step 5: Inspect the focused diff** — Run `git diff --check`; do not commit (user-directed).

### Task 5: Complete browser and Blackboard verification

**Files:** Modify this plan with final evidence.

- [ ] **Step 1: Static verification** — Run npm run test && npm run typecheck && npm run e2e. Expected: all pass and e2e prints E2E + GATE GREEN.

- [ ] **Step 2: Real background operation** — Start Blackboard, relay with EMBINDER_OPERATOR_TOKEN, Todo, and todo-worker using the same operator token plus Blackboard ID and LLM configuration. Externally create a todo-operate task using a natural-language subject and JSON input containing no Todo IDs/tool names. Confirm the Todo browser visibly changes and GET /api/v1/tasks/{id} returns completed with summary and actions.

- [ ] **Step 3: Failure and policy proof** — Create work while no Todo browser is connected and confirm failed with todo_module_unavailable. Create a destructive instruction, deny inline approval, confirm no Todo mutation and a failed Blackboard task.

- [ ] **Step 4: Record evidence** — Append exact commands, exit codes, Blackboard task IDs, browser outcomes, and failure/policy outcomes to this plan.

- [ ] **Step 5: Inspect final diff** — Run `git diff --check`; do not commit (user-directed).

## Local implementation evidence — 2026-07-23

- `node --import tsx scripts/todo-worker.mjs` -> exits idle with the explicit missing-config message; it does not claim work.
- `npm run test` -> React 17 files/54 tests, relay 5 files/20 tests, worker SDK 3 files/16 tests: PASS.
- `npm run typecheck` -> exit 0 across all workspaces.
- `npm run e2e` -> `E2E + GATE GREEN`, including operator snapshot missing-token 401 and authenticated discovery of the mounted `add_task` capability.
- Remaining: the Blackboard + configured LLM + live Todo browser proof in Task 5 Steps 2–3 was not run because those external services were not available in this workspace. The implementation is not complete until that evidence is recorded.
