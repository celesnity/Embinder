# Embinder — Build Status Report

_The agent moves into your app: one-hook pointer SDK · render-scoped agent context · server-side policy gate._
_(Working names during development: Minder / Warden. Repo: `celesnity/Embinder`.)_

**Status:** `embinder-pointer` feature complete on top of D1–D7 — `npm run e2e` passes **36 assertions** green. The repo's identity shifted with it (see `docs/ai/requirements/2026-07-18-feature-embinder-pointer.md`): the resident agent (bubble + embedded runtime) is the product; `/mcp` is an optional separated-agent path.

## embinder-pointer (2026-07-18)

| Piece | Status | Evidence |
|---|---|---|
| `useEmbinder` pointer (declare + anchor + lifecycle in one hook) | ✅ | `packages/react/src/use-embinder.ts` · 9 unit tests |
| Render-scoped context (mount/unmount → register/unregister, live fan-out) | ✅ | e2e "SC-2 after navigation the agent sees ONLY the Archive set" |
| Bound state (`context()` → debounced ws `context` msg → "On-screen now" system block) | ✅ | e2e SC-3 assertions; `packages/relay/src/chat.ts` |
| Grace semantics (~2 s: remount re-delivers, expiry rejects + cancels approvals) | ✅ | `packages/relay/src/registry.ts` · e2e SC-4 assertions |
| Resident bubble default-on, config from relay env via `/chat-config` (D-9) | ✅ | `packages/react/src/chat/ChatBubble.tsx` · e2e D-9 assertion |
| Two-page demo (Board ⇄ Archive), zero `list_*` tools | ✅ | `apps/todo/src/App.tsx` |
| MCP demoted to optional separated-agent path | ✅ | README framing; `/mcp` still e2e-covered |
| Unit test infra (vitest: react jsdom + relay node) | ✅ | `npm test` — 19 unit tests across packages |

_Earlier D1–D7 history (gate, approval, spotlight, hardening) below._

_Last updated: 2026-07-18_

---

## 1. Setup (pre-D1) — ✅ Done

- Cloned all 5 reference repos into `.references/` (gitignored, reference only):
  - `typescript-sdk-1x` — MCP SDK **v1.29.0** (pinned tag, **not** the 2.0.0-alpha on `main`)
  - `npm-packages` — WebMCP (`@mcp-b/react-webmcp` v4, `webmcp-polyfill`, `webmcp-local-relay`)
  - `webmcp-spec` — W3C `document.modelContext` IDL
  - `WebMCP` — MCP-B transport topology (archived, reference)
  - `CopilotKit` — client-side HITL anti-pattern (contrast)
- **Verified every load-bearing API against our actual checkout** (guide line numbers came from a different path). Confirmed:
  - `registerTool(name, config, cb)` @ `mcp.ts:1052`; throws on duplicate `:1065`
  - Capabilities-after-connect throw @ `server/index.ts:208` → primer tool required
  - `inputSchema` = Zod raw shape `{ field: z.string() }`
  - `getModelContext()` = `document.modelContext ?? navigator.modelContext` @ `model-context.ts:13`
  - Streamable-HTTP session wiring @ `simpleStreamableHttp.ts` (connect **before** handleRequest)
- Toolchain: node 26 / npm 11. Installed & linked: SDK 1.29.0, `@mcp-b/react-webmcp` 4.0.0, express 5, ws 8, zod 3.

---

## 2. Scaffold laid down

```
minderSDK/
├─ package.json            # npm workspaces: packages/*, apps/*
├─ tsconfig.base.json
├─ embinder.policy.json      # authoritative risk: 5 tools; delete_task + delete_all_tasks = destructive
├─ README.md
├─ scripts/
│  └─ e2e.mjs              # one-command E2E round-trip test (npm run e2e)
├─ apps/todo/              # Vite React-TS reference app
│  └─ src/{store.ts, App.tsx, main.tsx}
├─ packages/react/         # @embinder/react
│  └─ src/{index.ts, provider.tsx, model-context.ts}
└─ packages/relay/         # @embinder/relay
   └─ src/{server, gate, approval, audit, security, policy}.ts
```

---

## 3. Task status vs. the D1–D10 plan

Legend: ✅ done · 🟡 wired/partial · ⬜ not started

| Task | Status | Evidence / note |
|---|---|---|
| **T-A1** Vite React Todo + 5 actions | ✅ | `apps/todo/src/store.ts` (useReducer: ADD/TOGGLE/EDIT/DELETE/CLEAR) + `App.tsx` |
| **T-B1** EmbinderProvider = `document.modelContext` shim over ws | ✅ | `packages/react/src/provider.tsx` |
| **T-B2** `useWebMCP` tool declarations from component | ✅ | `App.tsx` — 5 tools; `destructiveHint` on delete_task/delete_all_tasks |
| **T-C1** McpServer + dynamic register/unregister | ✅ | `server.ts` `registerGatedTool`, `__gmc_ready` primer before `connect()` |
| **T-C2** Bridge tools/call → app → result | ✅ | `server.ts` `forwardToBrowser` (30s timeout, pending map) |
| **T-C3** Streamable HTTP (+ stdio) transport | ✅ | POST/GET/DELETE `/mcp`, `--stdio` — **per-session McpServer** (multi-client safe; fixed LM Studio "Already connected" crash) |
| **T-D1** Gate injection point (wrap handler) | ✅ | `gate()` in handler, after validation, returns canonical args to forward |
| **T-D2** Pause / resume | ✅ | destructive → pending → approve runs / deny → agent isError; abort rejects |
| **T-E1** Approval page (out-of-tab) | ✅ | `/approve` SSE page + `/api/pending` + `/api/decide`; CLI `[a]/[d]` fallback |
| **T-E2** Approval-view fidelity (Unicode strip) | ✅ | raw vs canonical shown, tamper flagged red, **canonical bytes execute** |
| **T-F1** Audit log append-only | ✅ | `audit.jsonl` intent+outcome per gated call (approver, latency) |
| **T-F2** Rate limit | ✅ | `session:tool`/60s vs `policy.rateLimit.perToolPerMin` → deny |
| **T-G1** One-time token + tab⇄session bind | ✅ | ws `/app` token-gated; app fetches via `/app-token`; separate approver-token |
| **T-G2** Loopback + Origin/Host allowlist | ✅ | Host/Origin middleware; `listen('127.0.0.1')` |
| **T-H1** WebMCP-native feature-detect path | ✅ | provider captures native surface, mirrors registrations (degrades to relay) |
| **T-I1** LM Studio wiring | ✅ | `mcp.json` committed; setup in `docs/DEMO.md` |
| **T-I2** MCP Inspector fallback | ✅ | deterministic client round-trip proven & scripted (`npm run e2e`) |
| **T-K0–K5** Spotlight + gate viz (`EMBINDER_VIZ`) | ✅ | driver.js spotlight; relay phase events (intent/gate/decided) w/ unified id; destructive → target **locked** + pending popover (canonical, link to `/approve`); a11y live region; feature-flagged & **code-split** (zero cost when `viz=false`) |
| **T-CB0–CB7** In-app chat bubble (Arch A) | ✅ | `/chat` route reuses registry + `runGatedCall` (one gate); `<ChatBubble>` via `useChatRuntime`; key in relay env (`LLM_KEY`); baseURL allowlist; driver.js Approve/Deny opt-in (`GMC_INLINE_APPROVAL=1`); proven in `npm run e2e` (stub LLM). Off by default → zero bundle. |

---

## 4. Verified working

- `npm run typecheck` → **exit 0** across all workspaces.
- `__gmc_ready` primer registered before `connect()` (avoids the capabilities-after-connect throw).
- **D3 milestone PROVEN — full tool-call round-trip, not just `initialize`.** `npm run e2e`
  spawns the relay, plays a fake browser app (ws `/app`) + a real MCP client (streamable HTTP),
  and asserts:

  ```
  PASS  tools/list includes add_task (got: __gmc_ready, add_task)
  PASS  agent received {ok:true} (got: {"ok":true,"added":"milk"})
  PASS  task "milk" landed in the app board (board: ["milk"])
  PASS  2nd session lists add_task too
  PASS  two concurrent MCP sessions coexist (per-session McpServer)
  ✅ E2E round-trip GREEN
  ```

  This rules out the three integration bug classes: (i) ws `/app` binds, (ii) `register/call/result`
  message shapes match end-to-end, (iii) `pending` map `id` routes results correctly — plus
  (iv) two concurrent MCP sessions coexist (regresses the LM Studio "Already connected" crash).
  Regression-guarded going forward via `scripts/e2e.mjs`.
- ⚠️ **Still to confirm manually:** the *live browser* path (`:5173` + a real MCP client such as
  Inspector), i.e. the same round-trip with the actual `@embinder/react` provider and DOM. The
  headless test exercises the identical wire protocol, so this is a smoke check, not a risk.

```
Agent ──/mcp──▶ relay ──ws /app──▶ todo app     ← built + E2E round-trip GREEN
                  │
                  └── gate ── approval surface   ← NEXT (D4/D5)
```

---

## 5. Where we are on the schedule

**D1 → D3 (backbone / critical path) is in place:** `T-A1 → T-B1 → T-C1/2/3`.
We're at the doorstep of **D4 (the gate)** — the core differentiator the guide calls *"toàn bộ sản phẩm"*.

---

## 6. Next up

| Priority | Task | Day | Why |
|---|---|---|---|
| 1 | **T-E1** Approval page `/approve` + real pause/resume | D5 | Core differentiator; turns gate from "throws" into product (AC-3/4) |
| 2 | **T-E2** wire canonicalize into approval view (raw vs canonical) | D5 | Function exists; needs UI (AC-5) |
| 3 | **T-F1** audit fields at the gate | D5 | Writer exists; thread real fields (AC-6) |
| 4 | **T-G1/G2** enforce token bind + Origin/Host allowlist | D6 | Primitives exist; enforce on routes |
| 5 | **T-F2** rate limit | D6 | — |
| 6 | **T-H1 / T-I1** WebMCP-native + LM Studio | D7 / D3.5 | Bonus / agent wiring |

**Known gap:** the ws `/app` hub holds a single `appSocket` (last-connection-wins) — fine for the one-tab demo, but multi-tab binding is a T-G1 follow-up.

---

## 7. How to run

```bash
npm install
npm run e2e        # headless proof: tool-call round-trip through the relay (spawns + tears down)

npm run relay      # http://127.0.0.1:7331/mcp  (ws app: ws://127.0.0.1:7331/app)
npm run todo       # http://localhost:5173

# point an MCP client at the relay:
npx @modelcontextprotocol/inspector
```
