# GrabMyCursor — Demo, Acceptance & Rehearsal Playbook (D8–D10)

The code for D4–D7 is done and gate-verified headlessly (`npm run e2e`, 17 assertions).
This playbook is the human-run part: model bake-off, acceptance walk-through, and rehearsal.

## 0. One-command start

```bash
npm install
npm run dev        # relay :7331 + todo :5173 together
# approvals page:  http://127.0.0.1:7331/approve   (keep this on a SECOND screen/window)
```

Headless proof any time: `npm run e2e` → `✅ E2E + GATE GREEN`.

## 1. Acceptance checklist (AC-1 → AC-7)

| AC | Claim | How to show | Auto-covered by `npm run e2e`? |
|----|-------|-------------|-------------------------------|
| AC-1 | Agent sees the tools | Inspector/LM Studio lists 5 tools (no `__gmc_ready`) | ✅ |
| AC-2 | Tool call round-trips | "add buy milk" → task appears at :5173, agent gets `{ok:true}` | ✅ |
| AC-3 | Gate pause/deny/approve | "delete all tasks" → pauses; Approve runs, Deny blocks | ✅ |
| AC-4 | No self-approve | `POST /api/decide` w/o approver-token → 403; app tab can't approve | ✅ |
| AC-5 | Approval-view fidelity | Task id with hidden unicode → page shows raw≠canonical, executes clean | ✅ |
| AC-6 | Audit trail | `audit.jsonl` gains intent+outcome lines per gated call | ✅ |
| AC-7 | Rate limit | Spam a tool > `perToolPerMin` → denied, logged | manual (see below) |

AC-7 manual check: set `rateLimit.perToolPerMin` low in `grabmycursor.policy.json`, call a tool in a
loop from Inspector; the N+1th returns "Rate limit exceeded" and audit shows `approver:"rate-limit"`.

## 2. In-app chat bubble (optional)

Feature-flagged; off by default. Enable via `<GrabMyCursorProvider chat={{ baseURL, model }}>`.

Relay env:
- `LLM_KEY` — API key for the OpenAI-compatible endpoint (stays server-side; never sent to the browser).
- `LLM_BASE_URL_ALLOWLIST` — comma-separated allowed hostnames for the browser-supplied baseURL (default `127.0.0.1,localhost`).
- `GMC_INLINE_APPROVAL=1` — enable the driver.js Approve/Deny buttons in the app tab (needs `viz`). Off → decisions happen only on `/approve`.

Run (LM Studio preset):
```bash
GMC_INLINE_APPROVAL=1 npm run relay
npm run todo
# LM Studio (or any OpenAI-compatible server) on 127.0.0.1:1234, a model loaded
```

## 3. Model bake-off (D8)

Load in LM Studio (Chat → Integrations → edit `mcp.json` = repo `mcp.json`). Test each with the
script in §4 and record which reliably tool-calls (watch :5173 mutate — never trust the model's prose).

| Model | Tool-calls reliably? | Notes |
|-------|----------------------|-------|
| Qwen2.5-7B-Instruct | ☐ | recommended baseline |
| Qwen2.5-14B-Instruct | ☐ | if machine allows |
| Llama-3.1-8B-Instruct | ☐ | alt |
| ~~ternary-bonsai-1.7b~~ | ✗ | too small — hallucinates success, do not use |

Turn OFF LM Studio's own tool-confirm (auto-approve) so the **relay gate** is the only gate on screen.

## 4. Rehearsal script (D9)

1. "What tasks are on the board?" → agent calls `list_tasks` (read, passes gate). Board shown.
2. "Add buy milk, eggs, and bread." → 3× `add_task` (write, passes gate). Tasks appear live at :5173.
3. "Delete the eggs task." → `delete_task` (destructive) **pauses**. Switch to `/approve` window →
   **Approve** → task disappears. (Point out: approval is on a separate surface, not the app tab.)
4. "Clear the whole board." → `delete_all_tasks` **pauses** → this time **Deny** → nothing happens,
   agent reports it was denied by the policy gate.
5. Fidelity beat: from Inspector, call `delete_task` with an id containing a hidden Tag/zero-width
   char → `/approve` shows **raw ≠ canonical** with a red warning; the clean bytes are what execute.
6. Show `audit.jsonl` — every intent and outcome, with approver + latency.

Record a backup video of this exact run.

## 5. Talking point (positioning)

GrabMyCursor is **governance ON WebMCP**, not an anti-injection oracle. The differentiator vs CopilotKit
HITL: the human gate lives **server-side, off the agent-driven tab** — the agent cannot reach the
approve button, and the approver sees the exact canonical bytes that will execute.
