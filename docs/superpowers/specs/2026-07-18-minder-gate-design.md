# Minder / Warden — Gate + Approval + Hardening Design (D4–D7)

_Design date: 2026-07-18 · Companion to `MINDER_BUILD_GUIDE.md` and `BUILD_STATUS.md`._

## Context

Backbone (D1–D3) is complete and verified: `npm run e2e` proves the agent→relay→app→result
round-trip GREEN, including two concurrent MCP sessions (per-session `McpServer`). This spec
covers the remaining work — the **server-side policy gate** and everything the guide schedules
through D7, which is the actual product (the differentiator vs client-side HITL).

Scope approved by the user: **all of D4→D10**. Code + scaffolding for every module; the
human-only parts of D8–D10 (model bake-off, rehearsal, backup video, landing copy) are delivered
as scripts/checklists, not performed.

## Architecture (remaining modules)

### Gate (T-D1/D2) — `packages/relay/src/gate.ts`
`gate(name, args, risk, signal, ctx)` runs inside the wrapped `registerTool` handler, after SDK
input-validation, before `forwardToBrowser`:
- `read` / `write` in-policy → pass through immediately.
- `destructive` or unknown (deny-by-default) → create a `PendingApproval { id, tool, argsRaw,
  argsCanonical, tampered, risk, session, resolve, reject }`, enqueue it, and **block**.
- Resolve on Approve → forward to app. Reject on Deny → agent receives `isError` "denied by
  policy gate". Reject on `signal.aborted` (agent cancelled / disconnected) → remove from queue.
- **Client-timeout policy:** the human wait has NO hard deadline; the MCP stream is kept alive
  with periodic progress notifications (`extra.sendNotification`, ~15s). The existing 30s
  `forwardToBrowser` timeout applies only to the forward leg, which starts *after* approval.

### Approval surface (T-E1/E2) — `packages/relay/src/approval.ts`
A pending-approval registry + Express routes on the same relay (port 7331), served OUTSIDE the
agent-driven app tab:
- `GET /approve` → self-contained HTML page (SSE client) that also receives an **approver-token**.
- `GET /api/pending` → **SSE** stream of the pending queue (live, no polling lag).
- `POST /api/decide {id, approve}` → requires the approver-token; resolves/rejects the pending.
- **Anti-self-approve (AC-4):** `/api/decide` requires the approver-token that only `/approve`
  holds. The app tab (even via DevTools) never has it → self-approve returns 403.
- **Fidelity (T-E2):** args are canonicalized (`canonicalize()` already implemented — NFC + strip
  Tag block, zero-width, bidi). The approval payload carries `raw`, `canonical`, and `tampered`;
  the page shows both and flags a red warning when they differ. **The canonical bytes execute.**
- CLI fallback: when stdin is a TTY, print the pending call and read `[a]/[d]`.

### Audit (T-F1) — `packages/relay/src/audit.ts`
Append-only `audit.jsonl`, one line per gated call: `{ ts, session, tool, argsRaw, argsCanonical,
decision, approver, latencyMs }`. Intent line before forward, outcome line after.

### Rate limit (T-F2)
`session:tool → count / 60s`; exceeding `policy.rateLimit.perToolPerMin` → deny before gate.

### Security (T-G1/G2) — `packages/relay/src/security.ts`
- **G1 token:** relay mints a ws app-token + a separate approver-token at start; prints them.
  App fetches its token from `GET /app-token` (relay checks `Origin: http://localhost:5173`);
  ws connect carries `?token=`; constant-time compare (not `requireBearerAuth` — needs expiry).
- **G2 origin/host:** `listen('127.0.0.1')` + Host/Origin allowlist middleware
  (`127.0.0.1:7331`, `localhost:7331` hosts; `http://localhost:5173` origin) to blunt
  DNS-rebinding (CVE-2025-49596 class). Loopback agents may skip bearer.

### WebMCP-native (T-H1) — `packages/react`
Feature-detect `document.modelContext ?? navigator.modelContext`; if a native surface exists,
register there too. Never hard-depend. Degrade to the relay shim otherwise.

### Agent wiring (T-I1/I2) + DX
- LM Studio `mcp.json` sample committed; README run steps; `list_tasks` read tool added so an
  agent can discover task ids and exercise all 5 actions.
- One-command DX: `npm run dev` (relay + todo together).

### D8–D10 (scaffolding only)
Model bake-off checklist, rehearsal script, and a landing stub — documents, not performed.

## Key decisions (approved)

| # | Decision | Choice |
|---|---|---|
| 1 | Approval transport | **SSE** `/api/pending` |
| 2 | Client timeout while waiting for human | **No hard deadline**; progress keepalive; 30s applies only to forward-after-approve |
| 3 | Anti-self-approve (AC-4) | **Separate approver-token**; `/api/decide` requires it → app tab can't self-approve |
| 4 | App↔relay token wiring (G1) | App `fetch('/app-token')`, relay Origin-checks `localhost:5173` |

## Verification

Extend `npm run e2e` with headless gate scenarios:
- (a) destructive → pending → programmatic approve → runs, app mutated.
- (b) destructive → deny → agent gets error, app unchanged.
- (c) `POST /api/decide` with wrong/absent approver-token → 403 (AC-4).
- (d) tampered args (hidden Tag chars) → pending payload shows `tampered:true`, canonical executes (AC-5).
- (e) audit.jsonl gains intent+outcome lines (AC-6).
- (f) rate-limit: N+1th call within 60s → denied (F2).

Acceptance = AC-1 → AC-7 green via the extended e2e + a manual approval-page click.

## Out of scope
No multi-tab session binding beyond last-wins (noted gap). No production auth/OAuth. No cloud
deploy. No unrelated refactors.
