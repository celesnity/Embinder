# Embinder architecture — learn the source

Read this to understand what the code actually is and how a tool call travels end to end.
Every reference is by **file + exported symbol** so it stays valid as the code moves. All
paths are relative to the repo root (`D:\[Project]_Embinder`).

> Naming note: legacy `GrabMyCursor` names still live in the source (`gmc-*` CSS,
> `__gmc_ready`, `GMC_INLINE_APPROVAL`, `.grabmycursor/`). Same project as `embinder`.

---

## 1. Repo layout & workspaces

npm workspaces, TypeScript + ESM, Node >= 20. Root `package.json` declares
`"workspaces": ["packages/*", "apps/*"]`. `tsconfig.base.json` sets `target ES2022`,
`module`/`moduleResolution` `NodeNext`, `strict`, `declaration`, `esModuleInterop`,
`skipLibCheck`, `resolveJsonModule`.

| Path | `name` | Role |
|---|---|---|
| `packages/react` | `@embinder/react` | App-side SDK: `EmbinderProvider`, re-exported `useWebMCP`, `grabAnchor`, spotlight, chat bubble. |
| `packages/relay` | `@embinder/relay` | Node MCP server + ws app-hub + **server-side policy/approval gate** + audit + chat loop. The core differentiator. |
| `apps/todo` | `todo` | React reference integration: provider, actions, context, resident chat, spotlight, and ghost cursor. |
| `apps/pocketbase` | *(Go server + vanilla/Shablon/Vite UI)* | Non-React reference integration. Its Admin UI uses a framework-neutral bridge, authenticated PocketBase SDK actions, live collection/schema context, the shared mascot/cursor, chat, CSP allowances, and embedded production assets. It is not an npm workspace, so run its UI and Go checks explicitly. |

Root scripts: `dev` (`node scripts/dev.mjs`), `relay`, `todo`, `e2e` (`node scripts/e2e.mjs`),
`build` (`--workspaces --if-present`), `typecheck` (same). Helpers in `scripts/`:
- `scripts/dev.mjs` — spawns relay + todo together (relay :7331, todo :5173), Windows tree-kill.
- `scripts/e2e.mjs` — the headless full-pipeline proof and the **authoritative wire-protocol
  spec**: boots the relay, plays a fake browser over ws, a real MCP client over `/mcp`, drives
  the approval SSE surface, and exercises `/chat` against a stub LLM.

### The dependency graph (important)

```
apps/todo ─▶ @embinder/react ─▶ @mcp-b/react-webmcp, @assistant-ui/*, driver.js, zod  (peer: react)

apps/pocketbase/ui ─▶ framework-neutral ws bridge + authenticated PocketBase browser SDK
                   └─▶ shared Embinder mascot/ghost-cursor source

@embinder/relay ─(standalone)─ @modelcontextprotocol/sdk, ai, @ai-sdk/openai-compatible, express, ws, zod

@embinder/react  ⟷  @embinder/relay   NO code import — coupled ONLY by the ws JSON protocol on :7331
```

There is **no compile-time edge** between the two packages. They agree on message shapes
(`register` / `unregister` / `result` / `call`) and phase events
(`intent` / `gate` / `decided` / `call` / `done`). Internally, in `@embinder/relay`,
`server.ts` imports every other module; `gate.ts` → `policy` + `approval` + `audit`;
`approval-routes.ts` → `approval` + `security`; `chat.ts` is self-contained and receives
`toolRegistry` + `runGatedCall` by injection.

---

## 2. `@embinder/react` — the app SDK (`packages/react/src/`)

The package ships raw `src` (no build step; Vite compiles it in the consuming app). Public
surface is `index.ts`, which exports:
- `EmbinderProvider` + type `EmbinderProviderProps` (from `provider.tsx`)
- `grabAnchor(name)` → `{ 'data-embinder-tool': name }` — spread onto the element a tool drives
- `getModelContext` + types `ToolDescriptor`, `ModelContextSurface` (from `model-context.ts`)
- `useWebMCP` — **re-exported straight from `@mcp-b/react-webmcp`** so apps declare tools with
  one import
- type `ChatBubbleConfig` (from `chat/ChatBubble.tsx`)

### `provider.tsx` — the heart of the app side
`EmbinderProvider({ children, url = 'ws://127.0.0.1:7331/app', token?, viz = false, chat? })`.

- **Installs a `document.modelContext` shim during render, not in an effect.** React runs
  child effects before parent effects, so a `useEffect` install would land *after* a child's
  `useWebMCP` already read `document.modelContext` — and tools would never register. The
  install happens in the render path (`ensureShim`) to beat the children.
- The shim + ws socket are a **module-scope singleton** (`createShim` / `ensureShim`), so
  React StrictMode's mount→unmount→mount cannot kill the socket.
- `ensureShim` does `Object.defineProperty(document, 'modelContext', { value, configurable: true })`.
- The ws opens lazily; the app token is fetched from `GET /app-token` unless passed as `token`.
  Registrations **buffer in an outbox** until the socket is open. Do not confuse buffering with
  reconnect/readiness proof; integrations must test delayed relay start and relay restart in the
  served browser and improve the provider/adapter if the target requires recovery.
- `registerTool(descriptor, options)` stores the descriptor locally, sends
  `{ type: 'register', tool: stripDescriptor(descriptor) }` over the ws — `stripDescriptor`
  sends `name/title/description/inputSchema/annotations` but **not the handler** (the handler
  stays in the browser) — mirrors to a native WebMCP surface if one exists, and wires an
  `AbortSignal` to send `{ type: 'unregister' }` on teardown.
- On an incoming `{ type: 'call' }` it looks up the local descriptor, runs its `execute`, and
  posts `{ type: 'result', id, result }` (or `error`) back. Phase events (`intent`/`gate`/…)
  are routed to the spotlight's phase listener instead.
- `viz` dynamically imports `./spotlight.js`; `chat` dynamically imports `./chat/ChatBubble.js`
  — both **code-split, zero cost when off**.

### `model-context.ts`
`getModelContext()` feature-detects `document.modelContext ?? navigator.modelContext`. Defines
`ToolDescriptor` (name/title/description/inputSchema/annotations/**execute**) and
`ModelContextSurface` (`registerTool`). `@mcp-b/react-webmcp` adapts the app-facing `handler`
into this `execute`.

### `spotlight.ts` — display-only visualization (driver.js)
`createSpotlight(approveUrl, decideBase?)` → `Spotlight { handle(PhaseMessage), destroy() }`.
`resolveEl(name)` does `document.querySelector('[data-embinder-tool="…"]')` — i.e. it finds the
element `grabAnchor` stamped. It moves the highlight through the phases:
- `intent` → highlight the owning element, popover of the canonical args.
- `gate` (awaiting) → **lock the element** (so a human can't click it either) with a pulsing
  "Waiting for owner approval" popover linking to `/approve`.
- `decided` → approved/denied styling. `call`/`done` → running/done.

Injects `gmc-*` CSS, mirrors phases to an ARIA live region, respects reduced-motion. It never
renders approve/deny buttons in the app tab **unless** `GMC_INLINE_APPROVAL=1` is set on the
relay (which exposes `/approver-token`, consumed via `postDecide` → `POST /api/decide`).

### `chat/ChatBubble.tsx` — optional in-app agent
`ChatBubble(cfg: ChatBubbleConfig)` where `ChatBubbleConfig` is `{ api?, baseURL?, model? }`
(defaults target relay `/chat` and LM Studio `http://127.0.0.1:1234/v1`,
`qwen2.5-7b-instruct`). Uses assistant-ui (`@assistant-ui/react` + `@assistant-ui/react-ai-sdk`)
with an `AssistantChatTransport` pointed at the relay `/chat` route. "One more agent through the
same gate."

---

## 3. `@embinder/relay` — MCP server + gate (`packages/relay/src/`)

Entry / `main`: `server.ts` (run via `tsx`; `bin: embinder-relay → ./dist/server.js`,
produced by `npm run build`). Constants `PORT = 7331`, `HOST = 127.0.0.1`.

### `server.ts` — the orchestrator
- Mints `APP_TOKEN` (ws `/app`) and `APPROVER_TOKEN` (`/api/decide`) at boot, writes
  `.embinder/session.json` (gitignored).
- Holds the central `toolRegistry: Map<name, ToolDef>` (source of truth) and a per-MCP-session
  `sessions` map.
- **`runGatedCall(name, args, destructive, session, signal, keepAlive?)` — the single shared
  pipeline** used by BOTH the MCP tool handler and the `/chat` route. It: assigns one lifecycle
  `id`, resolves risk via `riskOf`, canonicalizes args, emits `intent` and `gate` phase events
  **to the browser only** (never on the MCP path), calls `gate(...)`, emits `decided`, then
  `forwardToBrowser`.
- `forwardToBrowser(id, name, args)` — sends `{ type: 'call', id, name, args }` over the app ws
  and awaits a `result` (30s timeout); wraps it as an MCP `CallToolResult`.
- `registerGatedTool` / `buildSessionServer` — build a **fresh `McpServer` per MCP session**
  (the SDK binds one server ↔ one transport; this fixed the LM Studio "Already connected"
  crash) and mirror all registry tools onto it. A disabled `__gmc_ready` primer tool is
  registered before `connect()` (the SDK requires ≥1 tool before connect) then hidden from
  `tools/list`.
- `toZodShape` — minimal JSON-Schema → Zod raw shape (converts the `inputSchema` that arrived
  over the wire back into validators).
- Express (v5) middleware: Host/Origin allowlist + CORS (DNS-rebinding defense). Routes:
  `GET /app-token`, `GET /approver-token` (403 unless `GMC_INLINE_APPROVAL=1`),
  `POST/GET/DELETE /mcp` (StreamableHTTP transport), plus the mounted approval + chat routes.
  A `WebSocketServer` on `/app` (token + origin gated) handles `register`/`unregister`/`result`
  from the browser. Optional `--stdio` transport.

### `policy.ts` — authoritative risk
`type Risk = 'read' | 'write' | 'destructive'`; `Policy`; `loadPolicy(path)`;
`riskOf(policy, name, destructiveHint = false)`. Resolution order: **`embinder.policy.json`
wins** → else the app's `destructiveHint` → else `unknownTool` (deny-by-default =
`destructive`). Loaded from the root `embinder.policy.json`.

### `gate.ts` — the interception
`gate(name, argsRaw, risk, signal, ctx: GateCtx)`:
- Enforces the **rate limit** per `session:tool` per minute (`rateLimited`); over limit →
  audit `deny`/`rate-limit` and throw.
- Canonicalizes args and flags tampering (`tampered = JSON.stringify(raw) !== JSON.stringify(canonical)`).
- `read` / `write` → audit `allow` and return the canonical args immediately (pass-through).
- `destructive` → audit `pending`, start a **15s keep-alive ticker** (holds the MCP stream
  open), and `await requestApproval(...)` — **blocks until a human decides**.
- Returns the **canonical** args (what actually executes).

### `approval.ts` — transport-agnostic approval core
- `stripInvisible` (NFC normalize + strip Tag-block / zero-width / bidi Unicode) and
  `canonicalize` — this is why the approver sees clean bytes and tampering is flagged red.
- The pending-approval registry: `requestApproval` (enqueue + emit `add`, returns a promise
  that resolves on approve / rejects on deny or agent-abort), `decide(id, approve, approver)`,
  `listPending`, `subscribe`, `enableCliApprovals` (TTY `[a]/[d]`).
- Types `PendingApproval`, `PublicPending`, `ApprovalRequest`.

### `approval-routes.ts` — the out-of-tab surface
`mountApprovalRoutes(app, approverToken)`:
- `GET /approve` — a self-contained HTML page with the approver token embedded; shows canonical
  vs raw bytes + a tamper warning.
- `GET /api/pending` — SSE stream of the queue.
- `POST /api/decide` — **token-gated by `x-approver-token`**. This is the anti-self-approve
  control: the agent-driven tab (:5173) never loads `/approve`, so it never holds the token; a
  decide attempt from its DevTools returns 403.

### `chat.ts` — relay-hosted LLM loop ("Arch A")
`mountChatRoute(app, { toolRegistry, runGatedCall })` → `POST /chat`. AI SDK `streamText` +
`createOpenAICompatible`, capped at `stepCountIs(6)`. Builds AI-SDK tools **from the same
`toolRegistry`**, each tool's `execute` routing through **the same `runGatedCall`** — so a
bubble-driven agent passes the identical gate as an external MCP agent ("one gate").
`baseURLAllowed` is an SSRF / key-exfil guard: the browser-supplied `baseURL` host must be in an
allowlist (default `127.0.0.1,localhost`, override `LLM_BASE_URL_ALLOWLIST`); the API key
(`LLM_KEY`) stays server-side.

### `security.ts` & `audit.ts`
- `security.ts` — `mintToken` (24 random bytes base64url), `tokenMatches` (constant-time
  `timingSafeEqual`), `hostAllowed` / `originAllowed` + `ALLOWED_HOSTS` / `ALLOWED_ORIGINS`
  (loopback:7331 hosts and explicitly supported app origins, including the reference ports).
- `audit.ts` — `audit(path, entry)` appends one JSON line to `audit.jsonl`:
  `{ ts, session, tool, argsRaw, argsCanonical, decision, approver, latencyMs }`.

---

## 4. The wire protocol (the load-bearing contract)

Browser → relay (over `ws /app`):
- `{ type: 'register', tool: { name, title, description, inputSchema, annotations } }`
- `{ type: 'unregister', name }`
- `{ type: 'result', id, result }`  (or `{ type: 'error', id, error }`)

Relay → browser:
- `{ type: 'call', id, name, args }`
- phase events: `intent`, `gate` (`{ status: 'awaiting' | 'auto' }`), `decided`
  (`approved`/`denied`), `call`, `done` — display-only, consumed by the spotlight.

The **authoritative, runnable definition** of this protocol is `scripts/e2e.mjs` — it plays
both a fake browser and a real MCP client and asserts the exact shapes. When in doubt about a
message, read the e2e script rather than guessing.

---

## 5. End-to-end call trace

1. Agent sends an MCP `tools/call` over `POST /mcp`. The per-session `McpServer` validates args
   against the Zod schema and invokes the wrapped handler → `runGatedCall`.
2. `runGatedCall` mints one `id`, `riskOf(...)`, canonicalizes args, emits `intent` + `gate`
   phase events to the browser, calls `gate(...)`.
3. `gate` rate-limits, canonicalizes/flags tampering. `read`/`write` → audit `allow`, return.
   `destructive` → audit `pending`, start the 15s keep-alive, `await requestApproval(...)`
   (blocks).
4. A human decides **out-of-tab** at `GET /approve`; `POST /api/decide` (token-gated) →
   `decide(id, approve, approver)` resolves/rejects the pending promise.
5. Back in `runGatedCall`: on approve → emit `decided: approved`, `forwardToBrowser(...)`; on
   deny → emit `decided: denied` and rethrow (agent gets an MCP error, app never changed).
6. `forwardToBrowser` sends `{ type: 'call', ... }` over the ws; the browser shim runs the local
   `execute` (the app's `handler`) and posts `{ type: 'result', ... }` back.
7. The relay resolves the pending result and returns an MCP `CallToolResult` to the agent.
   Every step was written to `audit.jsonl`.

---

## 6. Invariants (from `CLAUDE.md`)

- Risk is **authoritative in `embinder.policy.json`**; `destructiveHint` is only an app default.
- TypeScript, ESM, **Zod raw-shape** input schemas (`{ id: z.string() }`, not a wrapped object).
- **Per-session `McpServer`** — one server per MCP session so concurrent clients coexist.
- The **handler stays in the browser**; only the descriptor crosses the wire.
- Approval is **out-of-tab** — the agent's tab cannot approve.
- **One gate** — the chat bubble and external MCP agents both go through `runGatedCall`.

---

## 7. Build & verify

| Purpose | Command |
|---|---|
| Startup harness (install + typecheck + e2e) | `.\init.ps1` |
| Install | `npm install` |
| Typecheck (all workspaces) | `npm run typecheck`  (expect exit 0) |
| Full behavioral proof | `npm run e2e`  (expect all assertions and "E2E + GATE GREEN") |
| Run the app | `npm run dev`  (relay :7331 + todo :5173) |
| Approvals surface | http://127.0.0.1:7331/approve |

Runtime output (`audit.jsonl`, `.embinder/`, legacy `.grabmycursor/`) is gitignored.
