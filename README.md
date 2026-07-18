<p align="center">
  <img src="assets/banner.png" alt="Embinder — a map for agents to drive your app, in the open." width="100%" />
</p>

<h1 align="center">Embinder</h1>

<p align="center">
  <b>A map for agents to drive your app — with a human gate they can't skip.</b><br/>
  WebMCP-native SDK · server-side policy gate · live action spotlight
</p>

<p align="center">
  <code>@embinder/react</code> (app side) · <code>@embinder/relay</code> (MCP server + gate)
</p>

---

## What it is

Embinder is the **map an AI agent reads to drive a web app**. Your components declare their
actions as tools; the agent sees them, calls them, and Embinder does three things at once:

1. **Tells the agent how to interact** — every action is a WebMCP tool (`useWebMCP`), so any MCP
   client (LM Studio, Claude, Inspector) discovers exactly what your platform can do.
2. **Lets the agent drive the user** — tool calls execute real UI actions in the user's own tab.
3. **Lets the user see — and gate — what happened** — a live **spotlight** highlights the exact
   element being driven, and destructive actions **pause at a human approval gate that lives on the
   server, off the tab the agent controls.**
- **Optional in-app chat bubble (feature-flagged)** — one more agent through the same gate.

The difference from client-side human-in-the-loop (e.g. CopilotKit): the approve/deny surface is
**server-side and out-of-band**. The agent cannot reach the button, and the approver sees the exact
**canonical bytes** that will execute — hidden/invisible Unicode stripped and flagged.

## Architecture

```
 Agent ──http /mcp──▶  @embinder/relay  ──ws /app──▶  Your app (@embinder/react)
                            │  ▲                          │
     phase events ──────────┘  │                          │  useWebMCP → tools
   (intent·gate·decided)       │                          ▼
                          policy gate ──────────▶  spotlight + gate viz (driver.js)
                            │
                            └── approval surface  http://127.0.0.1:7331/approve  (out-of-tab)
                                audit.jsonl · rate limit · token + origin allowlist
```

Single port `127.0.0.1:7331`: MCP at `POST/GET/DELETE /mcp`, the app attaches over `ws://…/app`,
and the human approves at `/approve`.

## Packages

| Package | Role |
|---|---|
| `@embinder/react` | App SDK. `EmbinderProvider` (installs a `document.modelContext` shim over ws), re-exported `useWebMCP`, `grabAnchor`, and the driver.js action **spotlight** (feature-flagged, code-split). |
| `@embinder/relay` | MCP server + ws hub + **policy gate**: per-session `McpServer`, approval surface, audit log, rate limit, token/origin hardening. |
| `apps/todo` | Reference app — a todo board exposing 5 tools, wired end-to-end. |

## Quick start

```bash
npm install
npm run dev        # relay :7331 + todo :5173 together
#   app:       http://localhost:5173
#   approvals: http://127.0.0.1:7331/approve   ← keep on a second window
```

Point any MCP client at `http://127.0.0.1:7331/mcp` (see `mcp.json` for the LM Studio config).
Prove the whole pipeline headlessly — no LLM needed:

```bash
npm run e2e        # ✅ E2E + GATE GREEN  (17 assertions, AC-1..AC-6)
```

## Declaring an action (app side)

```tsx
import { useWebMCP, grabAnchor } from '@embinder/react';

useWebMCP({
  name: 'delete_all_tasks',
  description: 'Delete every task on the board',
  inputSchema: {},
  annotations: { title: 'Clear board', destructiveHint: true }, // → gate pauses this
  handler: async () => { dispatch({ type: 'CLEAR' }); return { ok: true }; },
});

<button {...grabAnchor('delete_all_tasks')}>Clear all</button>  // spotlight anchors here
```

Risk is authoritative in `embinder.policy.json` (`read` / `write` pass through, `destructive` pauses,
unknown tools deny-by-default). `destructiveHint` from the app is only a default.

## The gate, seen

When an agent calls a destructive tool, the owning element is **spotlit and locked** (you can't even
click it by hand), a popover shows the canonical args and a link to the approval page, and the call
**hangs** until a human decides on `/approve`. Approve → runs. Deny → the agent gets an error, the app
never changed. Every call is written to `audit.jsonl` with approver and latency.

## Status

D1–D7 complete and verified (`npm run e2e`, 17 assertions, AC-1→AC-6; AC-7 rate-limit manual).
See [`BUILD_STATUS.md`](BUILD_STATUS.md) for the per-task map and [`docs/DEMO.md`](docs/DEMO.md) for
the acceptance + rehearsal playbook.

## License

MIT (intended). Reference sources under `.references/` are third-party and not distributed.
