---
name: embinder
description: >-
  This skill should be used when working on, extending, understanding, or
  integrating the Embinder (formerly GrabMyCursor) WebMCP "agent-drives-app"
  SDK — its `@embinder/react` app SDK, its `@embinder/relay` server-side
  policy/approval gate, the chat bubble, the driver.js spotlight, or wiring the
  agent into ANY web platform (React or non-React: Vue, Svelte, Angular, Solid,
  vanilla, SSR) so it can call the site's real UI actions. Use it to learn the
  source code, to add or gate new agent-callable actions, and — for an agent
  landing on an arbitrary app — to detect its stack, map its structure, adapt
  the integration, and report bottlenecks it can't wire.
version: 0.1.0
---

# Embinder

**Embinder is a map for agents to drive your app — with a human gate they can't skip.**

A website declares its real UI actions as WebMCP tools. An agent (LM Studio, Claude,
MCP Inspector, or the built-in chat bubble) discovers those tools and calls them, which
executes the actual action in the *user's own browser tab*. A live **spotlight** shows the
element being driven, and any **destructive** action **pauses at a human approval surface
that lives on the server — off the tab the agent controls**, so the agent cannot approve
its own action. The approver sees the exact **canonical bytes** that will execute (hidden /
invisible Unicode stripped and flagged).

Three things happen at once:
1. **Declare** — every action is a WebMCP tool (`useWebMCP`), discoverable by any MCP client.
2. **Drive** — a tool call runs the real UI action in the user's tab.
3. **See & gate** — the spotlight highlights the driven element; destructive calls block on
   an out-of-tab approval gate. Every call is written to `audit.jsonl`.

## One process, one port, three protocols

Everything runs on a single loopback port, `127.0.0.1:7331`:

```
Agent ──http /mcp──▶  @embinder/relay  ──ws /app──▶  Your app (@embinder/react)
                          policy gate ──▶ inline Approve/Deny (in-app, on screen)
                          /chat (bubble) · audit.jsonl · rate limit · token + origin allowlist
```

- `POST/GET/DELETE /mcp` — the agent (any MCP client) connects here.
- `ws://…/app` — the website's browser tab attaches here.
- `POST /api/decide` — the human approval decision (token-gated, sent from the app tab).
- `POST /chat` — the optional in-app chat bubble's LLM loop (routes through the same gate).

## The key that makes it click

The two SDK packages have **no compile-time edge**. `@embinder/relay` never imports
`@embinder/react` and vice-versa — they agree only on a **JSON-over-ws protocol**
(`register` / `unregister` / `result` from the browser, `call` to the browser, plus phase
events `intent` / `gate` / `decided` / `call` / `done`). The handler that actually performs
an action **stays in the browser**; only its descriptor (name/schema/annotations) crosses to
the relay. Understand this and the rest of the system follows.

Because the wire protocol is the whole API, Embinder is **not React-only** — it works on **any
web frontend** (Vue, Svelte, Angular, Solid, vanilla, SSR). `@embinder/react` is just packaging;
a non-React host speaks the same protocol in ~30 lines (`references/embinder-bridge.js`).
**Honesty boundary:** "any platform" means any *web frontend with a live DOM + JS runtime +
WebSocket-to-loopback* — native mobile, CLI, and pure-backend targets can't be driven (WebMCP is
a browser surface).

## Read X for Y

| To… | Read |
|---|---|
| Learn the source code, module by module | `references/architecture.md` |
| Wire the agent into a **React** app / add a new action | `references/integration.md` |
| Integrate into **any other platform** (detect stack → map → adapt → report) | `references/platform-playbook.md` |
| Drop the framework-agnostic bridge into a non-React app | `references/embinder-bridge.js` |
| See the authoritative wire protocol (runnable spec) | `scripts/e2e.mjs` |
| Understand the single choke point every call passes through | `runGatedCall` in `packages/relay/src/server.ts` |
| See / change per-tool risk | `embinder.policy.json` |
| Learn the operating rules for this repo | `CLAUDE.md`, `claude-progress.md`, `feature_list.json` |

## Gotchas (read before trusting anything)

- **Dual naming — the project was renamed, the source wasn't fully.** You will see legacy
  `GrabMyCursor`-era names alongside `embinder`: CSS classes `gmc-*`, the internal primer tool
  `__gmc_ready`, the env var `GMC_INLINE_APPROVAL`, and the gitignored runtime dir
  `.grabmycursor/` (current runtime dir is `.embinder/`). The git repo slug is still
  `celesnity/GrabMyCursor`. These are the same project — don't treat them as separate.
- **`apps/pocketbase/` is unrelated vendored Go** (upstream PocketBase). It has no
  `package.json`, is not in the npm workspace, and is **not part of the SDK**. Ignore it.
  The real reference app is `apps/todo`.
- **Anchors are file + symbol, never line numbers.** This skill points at symbols
  (`EmbinderProvider`, `runGatedCall`, `riskOf`, …) so it survives edits. Before relying on a
  cited symbol, confirm it still exists (`Grep` the name).
- **Baseline discipline (from `CLAUDE.md`).** Verify with `.\init.ps1` (install + typecheck +
  e2e) before building on the code. Risk is authoritative in `embinder.policy.json`;
  `destructiveHint` on a tool is only a default the policy can override.
