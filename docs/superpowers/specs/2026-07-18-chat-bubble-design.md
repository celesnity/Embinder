# In-app Chat Bubble for GrabMyCursor — Design (Arch A)

_Date: 2026-07-18 · Status: approved for planning_

## Purpose

Add an optional, feature-flagged `<ChatBubble>` to `@grabmycursor/react` so a user can
try GrabMyCursor without an external MCP client. The bubble is **not a product** — it is
**one more agent** that goes through the **same tool registry** and the **same gate** as any
external agent. It must not become assistant-ui / CopilotKit.

Three inviolable laws (from `MINDER_CHATBUBBLE_GUIDE.md`):

1. **One tool source.** Tools exposed to the bubble's LLM = the existing gated registry. No
   second tool definition.
2. **One gate.** Every tool `execute` routes through the relay gate. The bubble cannot bypass
   it (that is exactly the CopilotKit client-side anti-pattern we contrast against).
3. **Session memory only.** Chat state lives in-memory for the page session (refresh clears
   it). No threads, no persistent history, no RAG, no model router.

## Decisions (locked)

- **Architecture: Arch A (relay-hosted loop).** The relay hosts the LLM loop on a `POST /chat`
  SSE route; the LLM API key stays in relay env and never reaches the browser.
- **Client state: `useChatRuntime`, no zustand.** assistant-ui binds directly to `/chat` via
  `@assistant-ui/react-ai-sdk`. The AI SDK holds messages in-memory (refresh = clean =
  "session memory"). **T-CB1 (zustand store) and T-CB2 (client tool-bridge) are dropped as
  YAGNI** — in Arch A tools live server-side and messages are managed by the SDK.
- **Config: bubble sends `baseURL` + `model`; key in env.** The bubble has a small settings
  popover for endpoint + model, sent per-request. The API key is `LLM_KEY` in relay env only.
- **Gate-in-chat: driver.js spotlight with Approve/Deny.** Reuse the existing
  `packages/react/src/spotlight.ts` (already driver.js). On a destructive tool the spotlight
  highlights the tool's anchor and renders a popover showing the **canonical args** plus
  Approve/Deny buttons that `POST /api/decide`. The relay verifies the approver token
  server-side and remains authoritative.

### Why the driver.js Approve/Deny buttons still satisfy AC-4

AC-4 = "even the in-app agent cannot approve its own destructive action." The LLM acts **only**
through registered tools; it has no tool to click a DOM button or read the approver token from
page memory. A human clicking Approve in the spotlight popover is therefore an out-of-band
gesture the agent physically cannot perform. The relay verifies the approver token (separate
from the app/agent token) on `/api/decide`, so the decision stays authoritative server-side.

## Architecture

```
apps/todo (browser)                          packages/relay (npx, holds LLM_KEY)
┌─────────────────────────┐                  ┌──────────────────────────────────┐
│ <ChatBubble>            │  POST /chat SSE  │ POST /chat                        │
│  assistant-ui           │ ───────────────▶ │  streamText(model, msgs, tools)   │
│  useChatRuntime({api})  │ ◀─────────────── │  tools = SAME gated registry      │
│                         │  UIMessage SSE   │  tool.execute = gate()→forward    │
│ <MinderProvider>        │                  │        │                          │
│  document.modelContext  │ ◀── ws /app ───▶ │  forwardToBrowser (existing)      │
│  spotlight.ts (driver)  │  call / result   │  gate() (existing, Module D)      │
└─────────────────────────┘                  └──────────────────────────────────┘
        ▲ Approve/Deny (driver.js popover) ── POST /api/decide ──▶ relay verifies token
```

The `/chat` route reuses the exact gated tool set the MCP path already builds. A tool called by
the bubble's LLM and a tool called by an external agent over MCP travel the identical
`gate() → forwardToBrowser` path. One registry, one gate — by construction.

## Components

| Unit | File | Responsibility | Depends on |
|---|---|---|---|
| Chat route | `packages/relay/src/chat.ts` (new) | `POST /chat`: build `createOpenAICompatible` provider from env key + request `baseURL`/`model`; `streamText` with gated tools; `stopWhen: stepCountIs(6)`; pipe UIMessage stream to the SSE response | gate (existing), server tool registry, `ai`, `@ai-sdk/openai-compatible` |
| Route wiring + allowlist | `packages/relay/src/server.ts` (edit) | Mount `/chat`; validate request `baseURL` against `LLM_BASE_URL_ALLOWLIST` (default `127.0.0.1,localhost`); bind the chat call to the app ws session used for `forwardToBrowser` | chat.ts |
| ChatBubble | `packages/react/src/chat/ChatBubble.tsx` (new) | `AssistantRuntimeProvider` + `useChatRuntime({ api })` + `AssistantModal` (the floating FAB). Settings popover for `baseURL` + `model`, sent as request body fields | `@assistant-ui/react`, `@assistant-ui/react-ai-sdk` |
| Gate spotlight (extend) | `packages/react/src/spotlight.ts` (edit) | On a `gate` phase event for a destructive tool, `highlight()` the tool's `data-minder-tool` anchor with a popover showing canonical args + Approve/Deny buttons; buttons `POST /api/decide` with the approver token | driver.js (already a dep), existing phase events |
| Flag + export | `packages/react/src/index.ts`, `provider.tsx` (edit) | `<MinderProvider chat={{...}}>` → dynamic-import `ChatBubble`; off = zero bundle cost | — |

## Data flow

**Happy path (read/write tool):**

1. User types in bubble → `useChatRuntime` POSTs `{ messages, baseURL, model }` to `/chat`.
2. Relay validates `baseURL ∈ allowlist`, builds the provider with the **env key**, runs
   `streamText` with gated tools.
3. LLM emits a tool call (e.g. `add_task`) → `tool.execute` → `gate()`. Read/write in-policy
   passes straight through → `forwardToBrowser` → app mutates → result streams back → LLM
   continues (up to 6 steps).

**Gated path (destructive tool):**

4. LLM calls e.g. `delete_all_tasks` → `gate()` emits a `gate` phase event over ws `/app`,
   then blocks on `requestApproval`. The bubble shows the tool call as running; `spotlight.ts`
   catches the phase event and **driver.js highlights the target with an Approve/Deny popover**
   (canonical args shown). The SSE stream stays open via the existing keepAlive ticker.
5. Human clicks **Approve** → `POST /api/decide` (approver token) → relay resolves
   `requestApproval` → `execute` returns canonical args → forward → stream continues.
   **Deny** → tool returns `isError` → the LLM sees the denial and can respond.

## Config & security

- **Key never leaves the relay.** `LLM_KEY` in env only. The bubble sends `baseURL` + `model`
  per request; it never sends or holds the key.
- **baseURL allowlist** (`LLM_BASE_URL_ALLOWLIST`, default `127.0.0.1,localhost`) blocks
  redirecting the server's key to an attacker-controlled endpoint (SSRF / key-exfil guard).
  A request whose `baseURL` is outside the allowlist gets `400`.
- **Approver token** for the inline Approve/Deny buttons is the *separate* approver token (not
  the app/agent token), fetched via the existing approver route. AC-4 holds because the LLM
  has no tool to click the button or read the token.
- **LM Studio preset** for the settings popover: `baseURL: http://127.0.0.1:1234/v1`, any key
  (env), model as loaded. Works with any OpenAI-compatible endpoint.

## API verification notes

- Provider: `createOpenAICompatible({ name, apiKey, baseURL })` from
  `@ai-sdk/openai-compatible` (AI SDK docs, Context7-verified).
- Loop: `streamText({ model, messages, tools, stopWhen })`. The multi-step stop helper is
  `stepCountIs(n)` in current `ai` — confirm the exact export against the installed version at
  implementation time (the guide notes it may be `isStepCount` in older versions).
- SSE response: `result.pipeUIMessageStreamToResponse(res)` (or `toUIMessageStreamResponse()`).
- UI: `useChatRuntime({ api })` from `@assistant-ui/react-ai-sdk`; `AssistantModal` +
  `AssistantRuntimeProvider` from `@assistant-ui/react`.
- Spotlight: driver.js `driverObj.highlight({ element, popover })` for a single-element
  highlight; custom Approve/Deny buttons via `onPopoverRender` appending to
  `popover.footerButtons`, or `showButtons` + `nextBtnText`/`onNextClick` (Context7-verified).

## Testing

Extend `scripts/e2e.mjs` with a **stub OpenAI-compatible endpoint** (a tiny local server that
returns a canned tool-call stream) so no real LLM is needed. Assert:

1. A read/write tool called via `/chat` round-trips through the browser stub and lands on the
   board.
2. A destructive tool blocks at the gate until a simulated `POST /api/decide` resolves it, then
   completes.
3. A `/chat` request whose `baseURL` is outside `LLM_BASE_URL_ALLOWLIST` returns `400`.

## Feature flag & build order

Off by default; `chat` prop absent → `ChatBubble` is never imported (zero bundle cost).

1. `packages/relay/src/chat.ts` `/chat` route + allowlist → green via extended `e2e.mjs`.
2. `ChatBubble.tsx` with `useChatRuntime` + `AssistantModal`; wire the flag/dynamic-import.
3. Extend `spotlight.ts` with the Approve/Deny popover posting to `/api/decide`.
4. Settings popover for `baseURL` + `model`.
5. Allowlist + approver-token hardening pass.

Minimum green: the bubble calls one tool through the gate (a destructive one, showing the
driver.js Approve/Deny popover) and the action lands in the app.

## Out of scope (guardrails)

- No zustand store, no client-side tool bridge (Arch A makes both unnecessary).
- No thread list, persistent history, RAG, or model routing. The moment any of these appears,
  stop — the bubble has become assistant-ui.
- The bubble is a low-friction front door, not the marketing centerpiece. The pitch stays
  "external agent + gate."
