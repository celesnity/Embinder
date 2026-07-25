# Mako White Paper — Workflow Upgrade Base

> **Purpose:** Convert the Mako white paper into an actionable base for improving an agent workflow, implementation backlog, dataset strategy, and evaluation plan.
>
> **Intended users:** Coding agents, work/planning agents, engineering leads, and researchers.
>
> **Source boundary:** Sections labeled **Source-derived** summarize the paper. Sections labeled **Adaptation** translate its ideas into a practical workflow and are implementation recommendations rather than claims made directly by the paper.

---

## 1. Executive Summary

### Source-derived

The paper argues that operating the live web is a specialized reasoning problem that should not be handled entirely by a general-purpose frontier model.

It separates web-agent reasoning into two layers:

1. **Abstract reasoning**
   - Understand the user goal.
   - Decide what work must be done.
   - Coordinate tools and systems.
   - Reason across information outside the browser.

2. **Browser-bound reasoning**
   - Understand the current page state.
   - Identify the correct element among many candidates.
   - Choose the next browser action.
   - Interpret the result of that action.
   - Maintain coherence across a long, changing workflow.

The paper identifies four structural problems in wrapper-based web agents:

- **Context blow-up:** Repeatedly serializing full pages causes the prompt to grow continuously.
- **Low inductive bias:** A general model must reconstruct HTML structure that the browser already knows.
- **Missing signal:** HTML, screenshots, and hybrid representations each lose important information.
- **Human-authored filtering:** Hard-coded element filters cannot improve automatically from data.

Mako addresses these problems using three main design choices:

- **Epoch-aware attention and caching**
- **A learned representation/filter for web state**
- **Native encoding of web elements and their relationships**

The paper also argues that the model must learn from **trajectories**, not static pages. A trajectory contains the page state, chosen action, resulting state, state differences, and full multi-step workflow outcome.

### Adaptation

The main workflow change should be:

> Keep high-level planning and goal reasoning in a general work agent, but move browser-state interpretation, action selection, state tracking, and recovery into a specialized browser-operation layer.

The system should be optimized around complete workflows rather than isolated clicks.

---

## 2. Design Principles to Adopt

### 2.1 Separate Goal Reasoning from Browser Operation

**Work agent responsibilities**

- Interpret the user objective.
- Break the objective into browser-bound and non-browser tasks.
- Define completion conditions.
- Define constraints, policies, and approval requirements.
- Preserve business context across pages and tools.
- Decide when to stop, escalate, retry, or ask for confirmation.

**Browser operator responsibilities**

- Read the current browser state.
- Select relevant page elements.
- Decide the next browser action.
- Execute the action.
- Observe the result.
- Detect whether the page changed, navigated, failed, or entered an unexpected state.
- Recover from browser-level errors.

**Rule**

The browser operator should not repeatedly re-derive the entire business goal. It should receive a compact operational objective and required persistent facts from the work agent.

---

### 2.2 Treat a Browser Session as Page Epochs

An **epoch** is one stable page or application state context.

- The first observation in an epoch is a full snapshot.
- Later observations in the same epoch are stored as diffs.
- Navigation to a materially new page creates a new epoch.
- Old page-state data is removed from active browser context.
- Only explicitly required facts survive navigation.

#### Example

```text
Task context
  └── Epoch 0: Search page
        ├── Full snapshot
        ├── Diff after typing
        └── Diff after submitting
  └── Epoch 1: Results page
        ├── Full snapshot
        └── Diff after applying filter
  └── Epoch 2: Detail page
        └── Full snapshot
```

#### Required persistent facts

Examples:

- Search query used
- Selected product or record ID
- User-entered values
- Prior decision
- Authentication state indicator
- Workflow checkpoint
- Business constraint
- Approval status

These facts should be written into an explicit **workflow memory object**, not retained accidentally through old page tokens.

---

### 2.3 Represent Elements as Structured Semantic Units

Do not rely only on raw HTML or screenshots.

Each element record should combine:

- Stable element ID
- Element type
- Text and accessible name
- Relevant attributes
- Rendered visibility
- Enabled/disabled state
- Checked/selected state
- Bounding box or 2-D position
- Parent/child relationships
- Label-to-input relationship
- Form membership
- Role
- Focus state
- Recently changed status
- Off-screen/hidden status
- Actionability
- Confidence that the element is relevant to the current task

#### Suggested element object

```json
{
  "element_id": "el_0042",
  "tag": "input",
  "role": "textbox",
  "type": "search",
  "name": "Search",
  "text": "",
  "attributes": {
    "placeholder": "Search",
    "aria-label": "Search"
  },
  "rendered_state": {
    "visible": true,
    "enabled": true,
    "focused": false,
    "checked": null,
    "selected": null,
    "bbox": [120, 80, 420, 118]
  },
  "relationships": {
    "parent_id": "el_0010",
    "label_id": "el_0041",
    "form_id": "el_0008"
  },
  "recently_changed": false,
  "action_candidates": ["focus", "type"]
}
```

---

### 2.4 Replace Fixed Filtering with a Learnable Relevance Layer

A first implementation may use heuristics, but the architecture should support replacement by a learned scorer.

The relevance layer should score **all candidate elements**, including:

- Visible controls
- Hidden elements
- Off-screen elements
- Structural containers
- Recently changed elements
- Error messages
- Loading indicators
- Labels
- Disabled controls
- Navigation landmarks

#### Inputs to relevance scoring

- Current browser state
- Current operational objective
- Previous action
- Previous result
- Workflow memory
- Agent latent state or compact action history
- Element features
- Element relationships
- State-change features

#### Output

```json
{
  "element_id": "el_0042",
  "relevance_score": 0.93,
  "reason_codes": [
    "matches_objective",
    "actionable",
    "label_similarity",
    "recent_state_change"
  ],
  "included_in_context": true
}
```

#### Training rule

During supervised training, the element required for the recorded next action must never be removed from the training context.

---

## 3. Target Workflow

```text
1. Receive user objective
2. Work agent defines:
   - expected outcome
   - constraints
   - completion criteria
   - browser subtask
   - persistent facts
3. Browser runtime captures current page
4. Epoch manager decides:
   - same epoch
   - new epoch
   - modal/sub-state
5. Element encoder builds structured element graph
6. Relevance layer selects task-relevant elements
7. Browser operator chooses next action
8. Runtime executes action
9. Observer captures resulting state
10. Diff engine records changes
11. Verifier evaluates action result
12. Recovery policy handles failure or ambiguity
13. Workflow memory is updated
14. Continue until completion criteria are met
15. Store complete trajectory
16. Evaluate workflow-level success
17. Add qualified trajectory to training/evaluation datasets
```

---

## 4. Components to Build or Upgrade

## P0 — Foundation

### 4.1 Browser State Collector

- [ ] Capture DOM-backed element records.
- [ ] Capture accessibility-tree properties.
- [ ] Capture rendered state and element bounds.
- [ ] Capture hidden, disabled, selected, and checked states.
- [ ] Record page URL, title, frame, tab, and navigation state.
- [ ] Record modal, iframe, shadow DOM, and dynamic component boundaries.
- [ ] Generate stable element IDs within an epoch.
- [ ] Redact secrets before persistence.

### 4.2 Epoch Manager

- [ ] Detect full-page navigation.
- [ ] Detect soft navigation in single-page applications.
- [ ] Detect major page replacement.
- [ ] Distinguish a new epoch from a local state update.
- [ ] Store the first full snapshot per epoch.
- [ ] Store subsequent changes as diffs.
- [ ] Close old epochs while retaining explicit workflow memory.
- [ ] Support replay from snapshot plus ordered diffs.

### 4.3 Diff Engine

- [ ] Detect added elements.
- [ ] Detect removed elements.
- [ ] Detect text changes.
- [ ] Detect visibility changes.
- [ ] Detect enabled/disabled changes.
- [ ] Detect selection and checked-state changes.
- [ ] Detect layout movement.
- [ ] Detect URL, title, modal, tab, and frame changes.
- [ ] Detect loading and error-state transitions.

### 4.4 Workflow Memory

- [ ] Define a typed memory schema.
- [ ] Separate business facts from page state.
- [ ] Record the source and confidence of each fact.
- [ ] Mark facts as temporary, epoch-local, task-level, or reusable.
- [ ] Define what is allowed to cross authentication and privacy boundaries.
- [ ] Support explicit memory update events.

### 4.5 Action Schema

Support at minimum:

```text
navigate
click
double_click
hover
focus
type
clear
select
check
uncheck
scroll
press_key
upload
download
open_tab
close_tab
switch_tab
wait
extract
verify
request_approval
stop
```

Each action should include:

```json
{
  "action_id": "act_0018",
  "action_type": "click",
  "target_element_id": "el_0042",
  "arguments": {},
  "expected_effect": "open product detail",
  "timeout_ms": 10000,
  "risk_level": "low",
  "requires_approval": false
}
```

---

## P1 — Reliability and Efficiency

### 4.6 Structured Element Encoder

- [ ] Convert one browser element into one compact semantic record.
- [ ] Encode element relationships directly.
- [ ] Include rendered state in the same record.
- [ ] Add 2-D positional information.
- [ ] Add relationship types such as parent-child, label-for, form-member, and sibling.
- [ ] Create a compact serialization for non-neural baselines.
- [ ] Create embeddings suitable for a learned model.

### 4.7 Relevance Filter

**Baseline**

- [ ] Keyword similarity to objective.
- [ ] Accessibility-role weighting.
- [ ] Actionability scoring.
- [ ] Visibility and state-change scoring.
- [ ] Relationship expansion around high-value elements.
- [ ] Mandatory retention of error messages and loading states.

**Learned version**

- [ ] Build per-element inclusion labels from trajectories.
- [ ] Train next-action relevance scorer.
- [ ] Evaluate recall of the required target element.
- [ ] Add hard-negative elements from confusing layouts.
- [ ] Add hidden/off-screen target examples.
- [ ] Calibrate an inclusion threshold.
- [ ] Track context size versus task success.

### 4.8 Result Verifier

- [ ] Compare expected effect with observed diff.
- [ ] Determine success, failure, partial success, or uncertainty.
- [ ] Detect no-op actions.
- [ ] Detect navigation to the wrong page.
- [ ] Detect validation errors.
- [ ] Detect stale element targets.
- [ ] Detect accidental duplicate actions.
- [ ] Produce structured evidence for the next step.

### 4.9 Recovery Controller

- [ ] Retry after transient loading failure.
- [ ] Re-find an element after a DOM refresh.
- [ ] Backtrack to the previous checkpoint.
- [ ] Re-plan after unexpected navigation.
- [ ] Escalate when risk is high.
- [ ] Ask for approval before destructive or financial actions.
- [ ] Stop after a configurable retry budget.
- [ ] Record the complete recovery path in the trajectory.

---

## P2 — Learning System

### 4.10 Trajectory Store

- [ ] Store complete workflows rather than isolated page captures.
- [ ] Store success and failure trajectories.
- [ ] Store recovery attempts.
- [ ] Version schemas.
- [ ] Support replay.
- [ ] Support privacy deletion.
- [ ] Track data lineage.
- [ ] Separate training, validation, benchmark, and production replay sets.

### 4.11 Training Pipeline

- [ ] Generate next-action examples.
- [ ] Generate element-relevance examples.
- [ ] Generate outcome-verification examples.
- [ ] Generate recovery-policy examples.
- [ ] Generate epoch-boundary examples.
- [ ] Generate persistent-memory extraction examples.
- [ ] Weight rare and difficult workflows.
- [ ] Prevent benchmark leakage.
- [ ] Add site/domain holdout evaluation.
- [ ] Add layout-change robustness evaluation.

### 4.12 Workflow Benchmark

The benchmark must test complete tasks from start to finish.

- [ ] Multi-step authenticated workflow
- [ ] Long workflow with several page epochs
- [ ] Dynamic single-page application
- [ ] Hidden or off-screen target
- [ ] Ambiguous repeated controls
- [ ] Form validation failure
- [ ] Unexpected modal
- [ ] Expired session
- [ ] Recoverable network failure
- [ ] Conditional branching
- [ ] Cross-tab workflow
- [ ] Approval-gated action
- [ ] Workflow requiring persistent values across navigation

---

## 5. Dataset Gathering Plan

## 5.1 Required Data Unit: A Trajectory

A trajectory should contain:

```json
{
  "trajectory_id": "traj_2026_000001",
  "task": {
    "task_id": "task_001",
    "objective": "Compare three listings and save the best valid option",
    "constraints": [
      "price <= 200",
      "delivery before Friday"
    ],
    "completion_criteria": [
      "three valid options compared",
      "one option saved",
      "evidence recorded"
    ]
  },
  "environment": {
    "domain": "example.com",
    "application_type": "ecommerce",
    "authenticated": true,
    "browser": "chromium",
    "viewport": [1440, 900]
  },
  "epochs": [],
  "final_result": {
    "status": "success",
    "evidence": [],
    "total_steps": 18,
    "recovery_count": 2
  }
}
```

### Epoch record

```json
{
  "epoch_id": "epoch_02",
  "start_reason": "navigation",
  "initial_snapshot_ref": "snapshot_02",
  "persistent_memory_in": {
    "selected_item_ids": ["A12", "B51"],
    "budget": 200
  },
  "steps": []
}
```

### Step record

```json
{
  "step_id": 7,
  "timestamp": "2026-07-22T07:00:00Z",
  "operational_objective": "Open the second valid result",
  "page_state_ref": "state_02_04",
  "candidate_elements_ref": "elements_02_04",
  "included_elements": ["el_12", "el_18", "el_21"],
  "action": {
    "type": "click",
    "target_element_id": "el_18"
  },
  "expected_effect": "navigate to listing details",
  "result_diff_ref": "diff_02_05",
  "outcome": "success",
  "verifier_confidence": 0.96,
  "recovery": null
}
```

---

## 5.2 Data Sources to Gather

### Production-like sources

- Authenticated enterprise workflows
- Internal admin portals
- E-commerce workflows
- Booking workflows
- CRM workflows
- ERP workflows
- Support and ticketing workflows
- Job listing and candidate review workflows
- Report generation workflows
- Multi-stage form submissions

### Synthetic sources

- Controlled simulator applications
- Layout variations
- Randomly inserted modals
- Delayed loading
- Element reordering
- Renamed labels
- Hidden target elements
- Expired sessions
- Incorrect defaults
- Conditional forms
- Duplicate buttons
- Pagination and infinite scroll
- Network interruption scenarios

### Negative and recovery data

Do not collect only successful runs.

Gather:

- Wrong-element clicks
- No-op actions
- Stale element references
- Invalid form submissions
- Unexpected navigation
- Authentication expiration
- Pop-up interruption
- Partial completion
- User cancellation
- Policy refusal
- Retry success
- Retry exhaustion
- Backtracking success
- Human escalation

---

## 5.3 Dataset Labels

Each step should include labels for:

- Correct next action
- Valid alternative actions
- Required target element
- Relevant context elements
- Irrelevant hard negatives
- Epoch boundary
- Persisted facts
- Expected state change
- Actual state change
- Outcome class
- Failure category
- Recovery action
- Risk level
- Approval requirement
- Final workflow success

---

## 5.4 Dataset Quality Checks

- [ ] Every trajectory has explicit completion criteria.
- [ ] Final success is supported by evidence.
- [ ] Element IDs are stable inside each epoch.
- [ ] State diffs can reconstruct the full epoch.
- [ ] Sensitive values are redacted or tokenized.
- [ ] Failed actions include a failure reason.
- [ ] Recovery paths are not removed.
- [ ] The required next-action element is present in training input.
- [ ] Data includes hidden and off-screen elements.
- [ ] Data includes long workflows.
- [ ] Data includes unfamiliar layouts.
- [ ] Training and benchmark domains are separated.
- [ ] Duplicate trajectories are detected.
- [ ] Human corrections are preserved as supervision.

---

## 6. Metrics

## 6.1 Primary Workflow Metrics

- **Workflow completion rate**
- **Verified completion rate**
- **Completion rate without human intervention**
- **Completion rate after recovery**
- **Long-workflow completion rate**
- **Cross-domain completion rate**
- **Unseen-layout completion rate**

## 6.2 Step Metrics

- Next-action accuracy
- Target-element recall
- Valid-action recall
- No-op rate
- Wrong-page rate
- Recovery success rate
- Epoch-boundary accuracy
- Persistent-memory accuracy
- Result-verification accuracy

## 6.3 Efficiency Metrics

- Tokens per step
- Browser-state tokens per step
- Average included elements
- Snapshot-to-diff compression ratio
- Cache hit rate
- Latency per action
- Cost per completed workflow
- Repeated-state processing percentage

## 6.4 Safety Metrics

- Unauthorized action rate
- Destructive action without approval
- Secret leakage rate
- Incorrect transaction rate
- Duplicate submission rate
- Failure to stop after uncertainty
- Policy escalation precision and recall

---

## 7. Recommended Evaluation Matrix

| Dimension | Minimum test |
|---|---|
| Workflow length | 5, 20, 50, and 100+ steps |
| Epoch count | 1, 3, 10, and 20+ pages |
| Layout familiarity | seen, modified, unseen |
| Authentication | public, authenticated, expired session |
| Dynamics | static, AJAX, SPA, streaming updates |
| Visibility | visible, off-screen, hidden-until-triggered |
| Ambiguity | unique control, repeated labels, duplicate buttons |
| Failure | no failure, transient, recoverable, unrecoverable |
| Risk | read-only, reversible write, destructive/financial |
| Human involvement | autonomous, approval-gated, escalated |

---

## 8. Implementation Roadmap

## Phase 0 — Audit Current Workflow

**Goal:** Identify where the existing agent behaves like a wrapper.

Tasks:

- [ ] Map the current browser-agent architecture.
- [ ] Measure page serialization size.
- [ ] Measure context growth over long tasks.
- [ ] List all hard-coded element filters.
- [ ] Identify information lost between DOM, screenshot, and model input.
- [ ] Measure failure categories.
- [ ] Measure current workflow-level completion rate.
- [ ] Identify where the general model is parsing browser mechanics.
- [ ] Document current memory behavior across navigation.
- [ ] Establish a baseline benchmark.

Deliverables:

- Architecture diagram
- Failure taxonomy
- Baseline metrics
- Prioritized gap list

---

## Phase 1 — Instrumentation and Trajectory Logging

**Goal:** Capture enough structured data to reproduce and analyze every run.

Tasks:

- [ ] Implement structured element capture.
- [ ] Implement action logging.
- [ ] Implement result-state capture.
- [ ] Implement state diffs.
- [ ] Implement epoch IDs.
- [ ] Implement workflow memory logs.
- [ ] Implement success evidence.
- [ ] Add redaction.
- [ ] Add deterministic replay where possible.

Exit criteria:

- A failed workflow can be replayed and inspected step by step.
- Every action can be connected to its input state and resulting state.
- Full trajectories can be exported as JSONL or Parquet.

---

## Phase 2 — Epoch-Based Runtime

**Goal:** Stop repeatedly sending the full accumulated browser history.

Tasks:

- [ ] Introduce page-epoch boundaries.
- [ ] Keep one full snapshot per epoch.
- [ ] Use diffs inside an epoch.
- [ ] Move cross-page facts into typed workflow memory.
- [ ] Add a state-reconstruction test.
- [ ] Compare context size against the current system.
- [ ] Validate that long tasks remain coherent.

Exit criteria:

- Context size grows with the current state and recent diffs, not the full workflow.
- Required cross-page facts remain available.
- Reconstructed page state matches the observed page state.

---

## Phase 3 — Structured Context and Filtering

**Goal:** Replace raw-page prompting with compact, task-relevant element context.

Tasks:

- [ ] Add semantic element records.
- [ ] Add typed relationships.
- [ ] Build heuristic relevance scorer.
- [ ] Add mandatory retention rules for target, errors, and changed elements.
- [ ] Evaluate target-element recall.
- [ ] Tune context budget.
- [ ] Train the first learned relevance model.

Exit criteria:

- Required target-element recall meets the chosen threshold.
- Average browser context size is materially reduced.
- Workflow completion does not decrease.
- Unseen-layout performance improves or remains stable.

---

## Phase 4 — Verification and Recovery

**Goal:** Make the agent robust to unexpected results.

Tasks:

- [ ] Add expected-effect fields to actions.
- [ ] Add structured result verification.
- [ ] Add no-op detection.
- [ ] Add stale-target recovery.
- [ ] Add retry and backtracking.
- [ ] Add checkpointing.
- [ ] Add human approval and escalation.
- [ ] Train/evaluate recovery behavior from failed trajectories.

Exit criteria:

- The agent can detect when an action did not have the expected effect.
- Recoverable failures no longer terminate the full workflow.
- Recovery decisions are logged and benchmarked.

---

## Phase 5 — Learning Loop

**Goal:** Turn usage into better future performance.

Tasks:

- [ ] Curate successful and failed trajectories.
- [ ] Generate next-action training data.
- [ ] Generate relevance-filter training data.
- [ ] Generate verifier training data.
- [ ] Generate recovery training data.
- [ ] Add hard-negative mining.
- [ ] Add human-correction ingestion.
- [ ] Add scheduled benchmark evaluation.
- [ ] Track model and dataset versions.
- [ ] Add rollback when a new model reduces reliability.

Exit criteria:

- Production trajectories can be converted into training examples.
- Each model release is compared on a frozen workflow benchmark.
- Improvements are measured at workflow level, not only step level.

---

## 9. Coding Agent Task Brief

```markdown
You are the coding agent responsible for implementing a web-native browser-operation runtime.

Primary goal:
Build a browser workflow system that represents browser sessions as page epochs, records full trajectories, uses structured element records, limits model context to relevant elements, verifies action results, and supports recovery.

Implementation order:
1. Instrument browser state and actions.
2. Implement epoch detection.
3. Implement full-snapshot plus diff storage.
4. Implement typed workflow memory.
5. Implement semantic element records and relationships.
6. Implement heuristic relevance scoring.
7. Implement action result verification.
8. Implement recovery and replay.
9. Build dataset export.
10. Build workflow-level benchmark harness.

Constraints:
- Do not store secrets in raw trajectories.
- Do not use only screenshots as browser state.
- Do not use only raw HTML as model input.
- Preserve hidden, off-screen, structural, and recently changed elements.
- Keep the required target element in training contexts.
- Evaluate complete workflows, not only individual clicks.
- Every action must have an expected effect and observed outcome.
- Every failure must have a structured category.
- Every run must be replayable from captured state when technically possible.

Required outputs:
- Architecture documentation
- Typed schemas
- Unit tests
- Replay tests
- State reconstruction tests
- Benchmark runner
- Dataset exporter
- Metrics dashboard
```

---

## 10. Work Agent Task Brief

```markdown
You are the work/planning agent above a specialized browser operator.

Your responsibilities:
- Understand the user objective.
- Define success and completion evidence.
- Separate browser-bound actions from abstract reasoning.
- Provide the browser operator with a compact operational objective.
- Maintain business facts and constraints across page epochs.
- Avoid sending unnecessary full task history into every browser step.
- Evaluate whether the browser result satisfies the business goal.
- Request approval before risky, destructive, financial, or irreversible actions.
- Escalate when confidence is insufficient.
- Record decisions and their evidence.

For every workflow, produce:
1. Objective
2. Constraints
3. Completion criteria
4. Risk classification
5. Approval requirements
6. Persistent facts
7. Browser subtask
8. Expected evidence
9. Stop conditions
10. Escalation conditions

Do not:
- Reconstruct page structure manually when structured browser state is available.
- Assume an action succeeded without checking the resulting state.
- Keep old page state as unbounded text history.
- Treat a successful click as proof that the full workflow is complete.
```

---

## 11. Definition of Done

The upgraded workflow is ready for serious testing when:

- [ ] Browser state is stored as structured elements with rendered state.
- [ ] Page relationships are directly represented.
- [ ] Sessions are split into page epochs.
- [ ] Each epoch has a full snapshot followed by diffs.
- [ ] Cross-page facts use explicit workflow memory.
- [ ] The browser context is filtered by task relevance.
- [ ] The target element is almost always retained.
- [ ] Every action has an expected effect.
- [ ] Every result is verified.
- [ ] Recoverable failures trigger recovery rather than immediate termination.
- [ ] Full trajectories are stored.
- [ ] Sensitive data is redacted.
- [ ] Complete workflows are benchmarked.
- [ ] Long workflows do not show unbounded context growth.
- [ ] New model versions are evaluated against a frozen benchmark.
- [ ] Production data can feed a controlled learning loop.

---

## 12. Immediate Next Tasks

### This week

- [ ] Document the current browser-agent request/response schema.
- [ ] Add `trajectory_id`, `epoch_id`, `step_id`, and `action_id`.
- [ ] Capture a full structured page snapshot before each action.
- [ ] Capture the resulting state after each action.
- [ ] Add a first diff generator.
- [ ] Add explicit completion criteria to test tasks.
- [ ] Select 10 representative end-to-end workflows.
- [ ] Record at least 20 successful and 20 failed runs.
- [ ] Create the initial failure taxonomy.
- [ ] Build a simple replay viewer.

### Next iteration

- [ ] Introduce epoch detection.
- [ ] Add typed persistent workflow memory.
- [ ] Convert DOM nodes into semantic element records.
- [ ] Build a heuristic relevance scorer.
- [ ] Add expected-effect verification.
- [ ] Add no-op and wrong-navigation detection.
- [ ] Create the first workflow-level benchmark report.

### After enough data is available

- [ ] Train element relevance scoring.
- [ ] Train next-action selection.
- [ ] Train action-result verification.
- [ ] Train recovery selection.
- [ ] Evaluate domain holdout and layout holdout.
- [ ] Compare cost, latency, and completion against the current wrapper approach.

---

## 13. Key Decision Log

Use this section during implementation.

| Decision | Options | Selected | Reason | Evidence | Revisit date |
|---|---|---|---|---|---|
| Epoch boundary method | URL-only / DOM replacement / learned hybrid |  |  |  |  |
| Page representation | HTML / screenshot / hybrid / structured element graph |  |  |  |  |
| Relevance filter | heuristic / learned / hybrid |  |  |  |  |
| Diff granularity | node / subtree / semantic component |  |  |  |  |
| Memory lifetime | epoch / task / user |  |  |  |  |
| Verification method | rules / model / hybrid |  |  |  |  |
| Recovery policy | fixed / planner / learned hybrid |  |  |  |  |

---

## 14. Core Takeaway

The most important change is not simply selecting a smaller model or writing better prompts.

The architecture should be reorganized so that:

- The general agent reasons about goals and work.
- The browser layer reasons about page state and actions.
- Browser history is managed as epochs and diffs.
- Page structure is represented directly.
- Context selection can improve from data.
- Training uses complete state-action-result trajectories.
- Evaluation measures whether the whole workflow succeeds.

That structure creates a path toward lower context cost, lower latency, stronger long-horizon coherence, better recovery, and continuous improvement from real workflow data.
