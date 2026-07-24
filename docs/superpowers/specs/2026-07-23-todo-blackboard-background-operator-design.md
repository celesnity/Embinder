# Todo Blackboard Background Operator — Design

## Goal

Use Blackboard as an autonomous work queue for the live Todo module. An external agent creates a
natural-language Blackboard task without knowing Todo’s tool names, routes, card IDs, or state
shape. A background worker claims that task, uses an LLM to operate the currently connected Todo
browser module through its existing Embinder tools, and reports its outcome back to Blackboard.

Todo does not render Blackboard status, a work queue, agent controls, or agent diagnostics. The
only visible result is the normal Todo UI mutation performed by the worker, such as a new task,
an edit, or a completed item.

## Scope

- Blackboard tasks use the `todo-operate` capability.
- `subject` and `input` are treated as the human-style instruction for the operator, not as a
  Todo-specific integration payload.
- A Todo operator worker claims, executes, and completes/fails these tasks.
- The worker discovers the currently mounted Todo tool catalog and bounded screen context through
  relay-only endpoints, then uses an LLM tool loop to choose the existing Todo actions.
- Every chosen action executes through the relay’s current browser handler path.
- Task result/failure is reported to Blackboard using the existing Worker Agent SDK lifecycle.

## Non-goals

- The Todo browser does not create Blackboard tasks.
- The external creator does not supply Todo IDs, routes, schemas, or implementation details.
- There is no Blackboard dashboard, status banner, history, chat panel, or agent control surface in
  `apps/todo`.
- This does not create a Todo-specific backend mutation API or a second browser protocol.
- Background operation does not bypass Embinder policy or destructive approvals.

## Architecture

```
External agent
  -> creates Blackboard Task(capability: todo-operate, subject/input: natural-language work)
Blackboard
  -> Todo operator worker claims task
Todo operator worker
  -> relay: inspect available Todo tools + bounded live context
  -> LLM: selects existing Todo tools for the instruction
  -> relay: executes each selected tool through the connected browser handler
Todo browser module
  -> normal reducer/UI changes only
Todo operator worker
  -> Blackboard: complete_task(result) or fail_task(reason)
```

The relay is the only bridge into Todo. It exposes a server-only operator surface protected by a
dedicated worker credential. The surface returns callable tools and safe, bounded context for the
connected app, then invokes the same `runGatedCall`/browser-forwarding path used by existing agent
tools. It never exposes browser app tokens to the worker.

## Execution Contract

1. An external agent creates a `todo-operate` Blackboard task such as “Create a high-priority
   release-readiness task and add an owner tag.”
2. The worker claims the task through `defineWorkerAgent`.
3. Before executing, the worker requests the relay’s current operator snapshot. If no Todo module
   is connected or no applicable tools are mounted, the task fails with a specific availability
   reason.
4. The worker runs an LLM tool-calling loop with the task instruction, snapshot context, and a
   dynamically supplied tool set. Tool calls invoke relay operator endpoints, not Todo-specific
   code.
5. Relay applies policy. Read/write calls execute through the connected browser handler; destructive
   calls retain the existing approval flow and can fail or wait according to that policy.
6. The worker reports exactly one Blackboard terminal state: a concise completion result with
   performed actions and returned data, or a failure reason.

## Error Handling

| Condition | Result reported to Blackboard |
|---|---|
| No connected Todo module | `failed`: `todo_module_unavailable` |
| No applicable mounted tool | `failed`: `todo_capability_unavailable` |
| Relay credential rejected | `failed`: `relay_operator_unauthorized` |
| Browser handler/tool error | `failed` with the explicit relay/tool error |
| LLM produces no valid action/result | `failed` with schema/loop error |
| Destructive call denied or times out | `failed` with the existing policy result; no mutation |

## Verification

- Relay unit tests: authenticated operator snapshot, unavailable-module response, and tool
  execution forwarding.
- Worker tests: natural-language task becomes LLM tool calls and complete/fail lifecycle reports.
- Existing policy tests continue proving destructive approval is not bypassed.
- Real integration: run Blackboard, relay, Todo browser, and a deterministic LLM stub; create a
  `todo-operate` task externally, observe the Todo UI mutation, then confirm Blackboard completion
  contains the result.

## Done Criteria

- An external creator can submit a natural-language `todo-operate` task with no Todo internals.
- The worker changes the live Todo module through existing SDK tools only.
- Blackboard receives an accurate terminal result or failure.
- Todo contains no Blackboard/agent-status UI.
- Typecheck, unit suites, existing e2e, and the real Blackboard/browser operator flow pass.
