# Embinder vs. Mako Workflow Upgrade — Architecture Review

## Verdict

Do not implement [mako_workflow_upgrade_base.md](D:/[Project]_Embinder/mako_workflow_upgrade_base.md) as a replacement for the current Embinder SDK.

It is:

- Roughly **35% compatible as a direct SDK upgrade**.
- Roughly **80% valuable as a separate workflow-runtime roadmap**.
- A poor fit as a replacement for Embinder’s declared-capability architecture.

Mako addresses generic operation of arbitrary websites. Embinder’s goal is making a product AI-native through developer-declared semantic capabilities, real application handlers, render-scoped context, and a server-side gate. These are related problems, but different products.

TinyFish describes Mako as a web-native model that reads semantic elements, selects relevant elements, caches page state, and learns from production trajectories. It is offered through its API/MCP rather than as an SDK architecture that can be directly reproduced. Its claimed advantage depends heavily on proprietary production workflow data.

- [Official Mako page](https://www.tinyfish.ai/mako)
- [Mako announcement](https://www.tinyfish.ai/blog/meet-mako-a-model-built-to-operate-the-live-web)

| Dimension | Fit |
|---|---:|
| Problem recognition—context growth, long workflows, recovery | 8/10 |
| Alignment with Embinder’s product identity | 4/10 |
| Compatibility with current architecture | 4/10 |
| Near-term implementation readiness | 2/10 |
| Value after selective adaptation | 8/10 |

## Fundamental difference

| Area | Current Embinder | Mako proposal | Assessment |
|---|---|---|---|
| Target | Products whose developers integrate Embinder | Any live website, including uninstrumented sites | Different markets |
| Perception | Developer-declared tools, context pointers, scopes and anchors | DOM/accessibility/rendered-state element graph | Optional fallback, not core replacement |
| Execution | Calls real handlers, stores, routers and APIs | Generic click/type/scroll/keypress actions | Conflicts with Embinder’s strongest invariant |
| Context reduction | Render lifecycle, 16 KB context cap, focus scopes | Epoch snapshots, diffs and learned relevance | Complementary |
| Element selection | Deterministic declared capability/scope discovery | Learned scoring over all elements | Useful mainly for arbitrary sites |
| Safety | Authoritative per-tool server policy and approval gate | Per-action risk fields and requested approvals | Embinder is stronger, but needs dynamic risk |
| Verification | Small handler result; limited persistence checks | Expected effect plus observed diff | Significant Embinder gap |
| Recovery | Grace remount, reconnect and error return | Retry, backtrack, re-plan and checkpoints | Significant Embinder gap |
| Memory | Chat history plus temporary focus lease | Typed workflow memory | Significant Embinder gap |
| Observability | Gate-oriented `audit.jsonl` | Complete state/action/result trajectories | Significant Embinder gap |
| Learning | None | Dataset, labeling, training and model evaluation | Entirely new ML product |
| User experience | Resident panel, mascot, cursor, spotlight and approval | Mostly browser-operator internals | Proposal omits a major Embinder subsystem |

## Strongly compatible ideas

1. **Work-agent/browser-runtime separation**

   The resident model should receive explicit objectives, constraints, completion criteria and persistent facts instead of deriving them repeatedly.

2. **Workflow IDs and structured trajectories**

   Add `workflow_id`, `epoch_id`, `step_id`, `action_id`, inputs, policy decision, result, error, pre/post context and completion evidence.

3. **Typed workflow memory**

   Store business facts separately from page context, with source, confidence, lifetime and sensitivity.

4. **Expected-effect verification**

   A successful handler return is not sufficient. Tools should optionally declare postconditions or a verifier.

5. **No-op, duplicate and stale-state detection**

   This is especially valuable for writes and navigation.

6. **Recovery and checkpoints**

   Add controlled retry/re-plan behavior, but only for reads or explicitly idempotent operations.

7. **Workflow-level benchmarking**

   Current testing proves protocol mechanics better than long-horizon success. Add 5-, 20-, 50- and eventually 100-step scenarios.

8. **Metrics**

   Track workflow completion, verified completion, retries, approval frequency, context size, tokens, latency and cost.

9. **Semantic epochs**

   Use route, authenticated principal, selected resource, modal and `AgentScope` transitions as epoch boundaries. Store developer-declared semantic context snapshots and JSON diffs—not full raw DOM by default.

## Ideas that should not enter the core SDK

- Automatic collection of every DOM and accessibility node.
- Blind inclusion of hidden or off-screen elements.
- A universal `click(element_id)` tool.
- Generic typing into arbitrary inputs.
- Learned relevance replacing declared scopes.
- Automatic retry of writes or destructive calls.
- Training infrastructure inside `@embinder/react` or `@embinder/relay`.
- Treating DOM change as proof of backend success.
- Combining trusted declared capabilities and untrusted arbitrary browser control in one registry without a distinct policy namespace.

These would weaken Embinder’s claims that actions call real application paths and that developers deliberately define the agent surface.

## Important current-state findings

Fresh verification on `main` at `51a04be`:

- `npm run typecheck`: passed.
- `npm test`: React **53/53**, relay **17/17** passed.
- PocketBase Embinder tests: **3/3** passed.
- `npm run e2e`: failed consistently.

The E2E failure is baseline drift:

- Policy classifies `delete_task` as `write` in [embinder.policy.json](D:/[Project]_Embinder/embinder.policy.json:46).
- The tamper test still calls `delete_task` and waits for destructive approval in [scripts/e2e.mjs](D:/[Project]_Embinder/scripts/e2e.mjs:241).
- The progress log says this was already repointed to `bulk_delete` in [claude-progress.md](D:/[Project]_Embinder/claude-progress.md:63).
- The script registers `bulk_delete` twice but never uses it for that test.

Other evidence gaps:

- [README.md](D:/[Project]_Embinder/README.md:46) says the agent holds only on-screen actions, but Todo registers most actions globally through [tools.ts](D:/[Project]_Embinder/apps/todo/src/tools.ts:48).
- The live Todo task card mounts an `AgentScope`, but its actions are root-level tools; the headless E2E manually invents a scoped `card_action`. The fake E2E therefore does not fully prove the real Todo scope wiring.
- F-D8 real-browser, spotlight and rate-limit verification remains unstarted in [feature_list.json](D:/[Project]_Embinder/feature_list.json:132).
- F-D9 model rehearsal and F-D10 packaging/clean-clone shipping are also unstarted.
- The relay still uses one global `appSocket` in [server.ts](D:/[Project]_Embinder/packages/relay/src/server.ts:68), so multiple tabs are last-connection-wins.
- Chat stops after six model steps in [chat.ts](D:/[Project]_Embinder/packages/relay/src/chat.ts:200), incompatible with the proposed long workflows.
- The audit format records gate decisions and arguments, but not complete browser results, state transitions or workflow outcomes.
- AgentForm can write secrets into model inputs and audit logs; redaction is explicitly deferred.
- Inline approval gives the controlled app tab the approver token. The repository already documents that anti-self-approval was dropped.

These should be resolved before building a learning loop from supposedly reliable trajectories.

## Main drawbacks and barriers

| Barrier | Consequence | Required mitigation |
|---|---|---|
| Product-scope expansion | SDK becomes browser automation platform plus ML company | Separate packages and roadmaps |
| No trajectory corpus | Learned relevance cannot be trained credibly | Instrument first; collect governed data |
| Proprietary Mako advantage | White paper alone cannot reproduce model/data | Consider optional Mako provider integration |
| Secret and hidden-element capture | Credentials, tokens and tenant data may be persisted | Classification, redaction, encryption, deletion and consent |
| Generic action risk | A `click` can mean navigation, purchase or deletion | Contextual/dynamic policy, not one risk for all clicks |
| Non-idempotent recovery | Retries can duplicate purchases, submits or deletes | Idempotency keys and verify-before-retry |
| SPA epoch ambiguity | URL-only epochs will be wrong | Route + scope + modal + resource heuristics |
| DOM diffs are not business proof | Success toast may hide failed persistence | Application-declared verifiers/backend checks |
| Multi-tab/frame support | Current singleton socket cannot identify the correct surface | Per-tab app sessions and leases |
| Storage growth | Snapshots and diffs become large quickly | Quotas, compression, retention and sampling |
| Learned-filter false negatives | Required control may disappear from context | Deterministic declared fallback and recall threshold |
| Framework divergence | React provider and neutral bridge can drift | Shared protocol package and conformance suite |
| Current red E2E | New work would build on unreliable evidence | Repair and rerun baseline first |
| No real-browser matrix | Protocol success is being confused with product success | Complete F-D8 and target capability matrices |

## Recommended revised roadmap

### Phase 0 — Restore truth

- Fix the E2E policy/test mismatch.
- Reconcile README, build status, progress log and actual source.
- Complete F-D8 real-browser verification.
- Prove actual Todo `AgentScope` behavior rather than a fake scoped tool.
- Establish measurable workflow baselines.

### Phase 1 — Workflow envelope

Add a separate `@embinder/workflow` layer containing:

- objective;
- constraints;
- completion criteria;
- stop/escalation rules;
- workflow/epoch/step/action IDs;
- explicit evidence;
- sensitivity metadata.

Do not change action execution yet.

### Phase 2 — Trajectory V1

Record declared semantic context before and after calls, policy decisions, results/errors, latency and evidence. Add field-level redaction and retention policy before production collection.

### Phase 3 — Verification and safe recovery

Extend tool descriptors with optional:

- `expectedEffect`;
- `verify`;
- `idempotent`;
- `retryPolicy`;
- `sensitiveFields`;
- `completionEvidence`.

Never automatically retry destructive actions.

### Phase 4 — Semantic epochs and memory

Use route/scope/auth/resource changes as epochs. Store one semantic snapshot followed by JSON diffs. Maintain typed cross-epoch workflow facts.

### Phase 5 — Workflow benchmark

Start with Todo and PocketBase, then synthetic apps covering expired sessions, modal interruption, network errors, duplicate controls, approval denial and reconnect.

### Phase 6 — Optional browser operator

Create a distinct package such as `@embinder/browser-operator` for uninstrumented sites. Its capabilities should be clearly marked as inferred/untrusted and governed separately.

### Phase 7 — Learned relevance

Only after enough validated trajectories exist, train a scorer over declared capabilities/scopes first. Consider arbitrary DOM elements later. Retain deterministic fallback permanently.

## Final recommendation

Keep the Mako document, but rename and rewrite it as **“Embinder Workflow Runtime and Optional Browser Operator Roadmap.”**

The immediate strategic move is:

1. restore the green baseline;
2. finish live-browser proof;
3. add workflow IDs, verification, redacted trajectories and typed memory;
4. benchmark complete workflows;
5. then decide whether a generic Mako-style browser operator belongs as an optional adapter or whether Embinder should simply support Mako as another model/operator provider.
