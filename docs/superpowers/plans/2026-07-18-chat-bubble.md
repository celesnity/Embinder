# Chat Bubble (Arch A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, feature-flagged in-app `<ChatBubble>` that lets a user drive the app through an LLM, where every tool call travels the *existing* relay gate — including a driver.js Approve/Deny spotlight for destructive actions.

**Architecture:** The relay hosts the LLM loop on a new `POST /chat` SSE route (Arch A). The LLM API key stays in relay env. The route builds AI SDK tools from the *same* `toolRegistry` the MCP path uses, and each tool's `execute` runs the *same* gate via a shared `runGatedCall` helper. The browser bubble binds to `/chat` with assistant-ui's `useChatRuntime` + `AssistantChatTransport`. Destructive calls pause at the gate; the existing `spotlight.ts` (driver.js) grows Approve/Deny buttons that POST the decision to the relay, which stays authoritative.

**Tech Stack:** TypeScript, Express 5, `ai` (AI SDK v5) + `@ai-sdk/openai-compatible` (relay), `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` (react package), driver.js (already a dep), MCP SDK 1.29.0, ws, zod 3.

## Global Constraints

- Toolchain: node 26 / npm 11. npm workspaces (`packages/*`, `apps/*`).
- Relay binds loopback only: `127.0.0.1:7331`. App dev origin: `http://localhost:5173` / `http://127.0.0.1:5173` (see `ALLOWED_ORIGINS` in `security.ts`).
- **LLM API key never reaches the browser.** It lives in relay env `LLM_KEY` only. The browser sends `baseURL` + `model` per request.
- **One registry, one gate.** The chat route MUST reuse `toolRegistry` and go through `runGatedCall` (the same path MCP uses). No second tool definition, no second gate.
- **Session memory only.** No thread list, persistent history, RAG, or model router. The AI SDK's in-memory messages (cleared on refresh) are the session memory.
- **Feature-flagged, zero cost when off.** `chat` prop absent on the provider → `ChatBubble` is never imported. Inline approval (driver.js Approve/Deny) is opt-in via env `GMC_INLINE_APPROVAL=1`; default keeps the strict out-of-tab posture (link to `/approve`).
- AI SDK is **v5**: multi-step stop helper is `stepCountIs(n)`. If a task's `import { stepCountIs } from 'ai'` fails to typecheck, the installed version exposes `isStepCount(n)` instead — use that. Confirm once at Task 2 Step 2.
- Commit after every task. Conventional Commits.
- Regression net: `npm run e2e` must stay green after every relay-side task.

---

### Task 1: Extract `runGatedCall` (refactor, no behavior change)

Pull the gate+forward pipeline out of the `registerGatedTool` closure into a standalone, reusable function so the chat route can call the identical path. Behavior is unchanged; `npm run e2e` is the regression net.

**Files:**
- Modify: `packages/relay/src/server.ts` (extract function from `registerGatedTool`, lines ~102-143)

**Interfaces:**
- Consumes: existing module-scope `policy`, `AUDIT_PATH`, `emitToApp`, `forwardToBrowser`, `riskOf`, `canonicalize`, `gate`, `GateCtx`.
- Produces: `async function runGatedCall(name: string, args: unknown, destructive: boolean, session: string | undefined, signal: AbortSignal, keepAlive?: () => void): Promise<CallToolResult>` — module-scope in `server.ts`. Emits `intent`/`gate`/`decided` phase events, runs the gate, forwards canonical args to the browser, returns the `CallToolResult`. Throws on deny/abort/timeout.

- [ ] **Step 1: Add the extracted function above `registerGatedTool`**

In `packages/relay/src/server.ts`, add this function immediately before `function registerGatedTool(`:

```ts
// Shared gate+forward pipeline. Used by BOTH the MCP tool handler and the /chat route,
// so a bubble-driven agent and an external MCP agent travel the identical gate (one gate).
async function runGatedCall(
  name: string,
  args: unknown,
  destructive: boolean,
  session: string | undefined,
  signal: AbortSignal,
  keepAlive?: () => void,
): Promise<CallToolResult> {
  const id = randomUUID(); // one id for the whole lifecycle (T-K2)
  const risk = riskOf(policy, name, destructive);
  const canonicalPreview = canonicalize(args);

  // T-K: tell the app what's about to happen (display only — app executes nothing until `call`).
  emitToApp('intent', { id, name, argsPreview: canonicalPreview });
  emitToApp('gate', { id, status: risk === 'destructive' ? 'awaiting' : 'auto' });

  const ctx: GateCtx = {
    session,
    auditPath: AUDIT_PATH,
    rateLimitPerMin: policy.rateLimit?.perToolPerMin,
    keepAlive,
  };

  try {
    const canonicalArgs = await gate(name, args, risk, signal, ctx);
    if (risk === 'destructive') emitToApp('decided', { id, decision: 'approved' });
    return await forwardToBrowser(id, name, canonicalArgs);
  } catch (err) {
    if (risk === 'destructive') emitToApp('decided', { id, decision: 'denied' });
    throw err;
  }
}
```

- [ ] **Step 2: Replace the closure body in `registerGatedTool` to delegate**

Replace the `server.registerTool(name, def.config, async (args, extra) => { ... })` callback body (the whole block from `const id = randomUUID();` through the final `catch`) with a delegation to `runGatedCall`:

```ts
const tool = server.registerTool(name, def.config, async (args: unknown, extra) => {
  return runGatedCall(
    name,
    args,
    def.destructive,
    extra.sessionId,
    extra.signal,
    // Keep the MCP stream alive while a human decides (weak clients otherwise idle-timeout).
    () =>
      void extra
        .sendNotification({
          method: 'notifications/message',
          params: { level: 'debug', logger: 'grabmycursor', data: `awaiting approval for ${name}` },
        })
        .catch(() => {}),
  );
});
tools.set(name, tool);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @grabmycursor/relay`
Expected: exit 0, no errors.

- [ ] **Step 4: Run the regression net**

Run: `npm run e2e`
Expected: all existing assertions PASS, ending `✅ E2E + GATE GREEN`. (This proves the refactor preserved gate, approve, deny, fidelity, and audit behavior.)

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/server.ts
git commit -m "refactor: extract runGatedCall for reuse by the chat route"
```

---

### Task 2: Relay `/chat` route + baseURL allowlist + chat tool bridge

Add `POST /chat`: build a `createOpenAICompatible` provider (key from env, baseURL/model from the request), build AI SDK tools from `toolRegistry` whose `execute` routes through `runGatedCall`, run `streamText` with a 6-step cap, and pipe the UI message stream to the response. Prove it deterministically with a stub OpenAI-compatible endpoint added to `scripts/e2e.mjs` — no real LLM.

**Files:**
- Create: `packages/relay/src/chat.ts`
- Modify: `packages/relay/src/server.ts` (mount the route; export what `chat.ts` needs)
- Modify: `packages/relay/package.json` (add deps)
- Modify: `scripts/e2e.mjs` (stub LLM + chat assertions)

**Interfaces:**
- Consumes: `runGatedCall` (Task 1); `toolRegistry: Map<string, ToolDef>` and `ToolDef` from `server.ts`.
- Produces: `function mountChatRoute(app: Express, deps: ChatDeps): void` where
  `interface ChatDeps { toolRegistry: Map<string, { config: { description?: string; inputSchema?: ZodRawShape }; destructive: boolean }>; runGatedCall: (name: string, args: unknown, destructive: boolean, session: string | undefined, signal: AbortSignal, keepAlive?: () => void) => Promise<CallToolResult>; }`. Also `function baseURLAllowed(baseURL: string | undefined): boolean` (exported for the test).

- [ ] **Step 1: Install AI SDK deps into the relay workspace**

Run:
```bash
npm i ai @ai-sdk/openai-compatible -w @grabmycursor/relay
```
Expected: both added under `packages/relay/package.json` `dependencies`.

- [ ] **Step 2: Confirm the multi-step export name**

Run:
```bash
node -e "import('ai').then(m => console.log(['stepCountIs','isStepCount'].filter(k => k in m)))"
```
Expected: prints `[ 'stepCountIs' ]` (AI SDK v5). If it prints `[ 'isStepCount' ]`, use that name everywhere `stepCountIs` appears below.

- [ ] **Step 3: Write `packages/relay/src/chat.ts`**

```ts
// T-CB3 — relay-hosted LLM loop (Arch A). Key stays in env; baseURL/model come per-request.
// Tools are the SAME registry the MCP path uses; each execute routes through runGatedCall (one gate).
import type { Express, Request, Response } from 'express';
import { z, type ZodRawShape } from 'zod';
import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  toUIMessageStream,
} from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ChatDeps {
  toolRegistry: Map<string, { config: { description?: string; inputSchema?: ZodRawShape }; destructive: boolean }>;
  runGatedCall: (
    name: string,
    args: unknown,
    destructive: boolean,
    session: string | undefined,
    signal: AbortSignal,
    keepAlive?: () => void,
  ) => Promise<CallToolResult>;
}

// SSRF / key-exfil guard: the browser can set baseURL, so its host must be allowlisted,
// else an attacker could point the relay's key at their own endpoint. (default: loopback)
function allowlist(): string[] {
  return (process.env.LLM_BASE_URL_ALLOWLIST ?? '127.0.0.1,localhost')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function baseURLAllowed(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    return allowlist().includes(new URL(baseURL).hostname);
  } catch {
    return false;
  }
}

export function mountChatRoute(app: Express, deps: ChatDeps): void {
  app.post('/chat', async (req: Request, res: Response) => {
    const { messages, baseURL, model } = (req.body ?? {}) as {
      messages?: unknown[];
      baseURL?: string;
      model?: string;
    };
    if (!baseURLAllowed(baseURL)) {
      return res.status(400).json({ error: 'baseURL not allowed' });
    }
    if (!model || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'model and messages required' });
    }

    const provider = createOpenAICompatible({
      name: 'byo',
      apiKey: process.env.LLM_KEY ?? 'not-needed', // local endpoints (LM Studio) ignore it
      baseURL: baseURL!,
    });

    // Abort the gate/stream if the browser disconnects.
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const session = `chat:${randomUUID()}`;

    // Build AI SDK tools from the SAME registry. execute = the SAME gate. (one gate)
    const tools = Object.fromEntries(
      [...deps.toolRegistry].map(([name, def]) => [
        name,
        tool({
          description: def.config.description ?? name,
          inputSchema: z.object(def.config.inputSchema ?? ({} as ZodRawShape)),
          execute: async (args: unknown) => {
            const result = await deps.runGatedCall(
              name,
              args,
              def.destructive,
              session,
              controller.signal,
            );
            // runGatedCall returns a CallToolResult wrapping JSON text; hand the LLM the value.
            return JSON.parse(result.content[0].text as string);
          },
        }),
      ]),
    );

    const result = streamText({
      model: provider(model!),
      messages: await convertToModelMessages(messages as never),
      tools,
      stopWhen: stepCountIs(6),
    });

    pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({ stream: result.stream }),
    });
  });
}
```

- [ ] **Step 4: Mount the route in `server.ts`**

In `packages/relay/src/server.ts`, add the import near the other local imports (after the `mountApprovalRoutes` import):

```ts
import { mountChatRoute } from './chat.js';
```

Then, immediately after the existing `mountApprovalRoutes(app, APPROVER_TOKEN);` line, add:

```ts
// T-CB3: relay-hosted chat loop (Arch A). Reuses the registry + runGatedCall (one gate).
mountChatRoute(app, { toolRegistry, runGatedCall });
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @grabmycursor/relay`
Expected: exit 0. (If `stepCountIs` errors, switch to `isStepCount` per Step 2.)

- [ ] **Step 6: Add a stub OpenAI-compatible endpoint + chat assertions to `scripts/e2e.mjs`**

At the top of `scripts/e2e.mjs`, after the existing imports, add a minimal stub LLM server. It speaks the OpenAI `/v1/chat/completions` streaming shape: first turn → stream a tool call for `add_task`; second turn (a tool result is present) → stream a final text token. This makes the chat test deterministic with no real model.

```js
import { createServer } from 'node:http';

// Minimal OpenAI-compatible /v1/chat/completions stub (streaming). Turn 1: emit a tool call.
// Turn 2 (messages contain a tool role): emit a final text chunk. Enough to exercise the gate.
function startStubLLM(toolName, toolArgs) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const hasToolResult = (payload.messages ?? []).some((m) => m.role === 'tool');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const id = 'chatcmpl-stub';
      const created = 1700000000; // fixed; stub is deterministic
      if (!hasToolResult) {
        // stream one tool call
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: toolName, arguments: '' } }] }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(toolArgs) } }] }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

// Drive POST /chat and drain the UI-message SSE stream to completion.
async function runChat(baseURL, model, text) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      baseURL,
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text }] }],
    }),
  });
  if (res.status !== 200) return { status: res.status };
  const reader = res.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
  return { status: 200 };
}
```

Then, inside the `try { ... }` block, after the existing audit assertions (around line 152, before the closing `}` of `try`), add:

```js
  // --- T-CB3: bubble path drives a WRITE tool through the SAME gate ----------
  const stub = await startStubLLM('add_task', { text: 'from-bubble' });
  const stubURL = `http://127.0.0.1:${stub.port}/v1`;
  const chatWrite = await runChat(stubURL, 'stub-model', 'add a task');
  assert(chatWrite.status === 200, `/chat streamed ok (got ${chatWrite.status})`);
  assert(board.some((t) => t.text === 'from-bubble'), 'chat tool call landed on the board via the gate');

  // --- T-CB3: destructive from the bubble PAUSES at the gate, then approves --
  const stub2 = await startStubLLM('delete_all_tasks', {});
  const stub2URL = `http://127.0.0.1:${stub2.port}/v1`;
  const chatDestructiveP = runChat(stub2URL, 'stub-model', 'clear everything');
  const chatPend = await firstPending();
  assert(chatPend && chatPend.tool === 'delete_all_tasks', 'chat destructive call paused at the gate');
  await decide(chatPend.id, true);
  await chatDestructiveP;
  assert(board.length === 0, 'chat destructive call ran after approval');

  // --- T-CB3: baseURL outside the allowlist is rejected (SSRF guard) ---------
  const badBase = await runChat('http://evil.example.com/v1', 'stub-model', 'hi');
  assert(badBase.status === 400, `off-allowlist baseURL -> 400 (got ${badBase.status})`);

  stub.server.close();
  stub2.server.close();
```

- [ ] **Step 7: Run the full E2E**

Run: `npm run e2e`
Expected: all prior assertions PASS **plus**:
```
PASS  /chat streamed ok (got 200)
PASS  chat tool call landed on the board via the gate
PASS  chat destructive call paused at the gate
PASS  chat destructive call ran after approval
PASS  off-allowlist baseURL -> 400 (got 400)
```
ending `✅ E2E + GATE GREEN`.

- [ ] **Step 8: Commit**

```bash
git add packages/relay/src/chat.ts packages/relay/src/server.ts packages/relay/package.json package-lock.json scripts/e2e.mjs
git commit -m "feat: relay /chat route — bubble agent through the same gate (T-CB3)"
```

---

### Task 3: CORS + opt-in `/approver-token` route for the browser

The real browser bubble at `:5173` POSTs cross-origin to the relay at `:7331`. A JSON POST triggers a CORS preflight, so `/chat` (and later the inline Approve/Deny POST to `/api/decide`) need CORS. Also add an **opt-in** `GET /approver-token` so the app tab can obtain the approver token for the driver.js Approve/Deny buttons — gated behind `GMC_INLINE_APPROVAL=1` and the Origin allowlist, so the default posture stays strictly out-of-tab.

**Files:**
- Modify: `packages/relay/src/server.ts` (CORS middleware + `/approver-token` route)
- Modify: `scripts/e2e.mjs` (assert preflight + token gating)

**Interfaces:**
- Consumes: `originAllowed` (security.ts), `APPROVER_TOKEN`, `express` app.
- Produces: CORS headers on allowed-origin requests; `GET /approver-token` → `{ token }` only when `GMC_INLINE_APPROVAL=1`, else `403`.

- [ ] **Step 1: Add CORS middleware**

In `packages/relay/src/server.ts`, immediately after the existing Host/Origin allowlist middleware block (the one ending with `next();`), add:

```ts
// CORS for the app tab (:5173) so the browser bubble can POST /chat and /api/decide.
// Origin is already allowlisted by the middleware above; echo it and answer preflights.
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, x-approver-token');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

- [ ] **Step 2: Add the opt-in `/approver-token` route**

In `packages/relay/src/server.ts`, immediately after the existing `app.get('/app-token', ...)` handler, add:

```ts
// Opt-in (GMC_INLINE_APPROVAL=1): lets the app tab drive the driver.js Approve/Deny buttons.
// Off by default → the strict out-of-tab posture holds (decide only from /approve).
app.get('/approver-token', (req: Request, res: Response) => {
  if (process.env.GMC_INLINE_APPROVAL !== '1') return res.status(403).json({ error: 'inline approval disabled' });
  const origin = req.headers.origin;
  if (origin) res.set('Access-Control-Allow-Origin', origin); // already allowlisted by middleware
  res.json({ token: APPROVER_TOKEN });
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @grabmycursor/relay`
Expected: exit 0.

- [ ] **Step 4: Add gating assertions to `scripts/e2e.mjs`**

Inside the `try` block, after the Task 2 chat assertions, add:

```js
  // --- T-CB / T-E: /approver-token is off unless explicitly enabled ---------
  const tokOff = await fetch(`${BASE}/approver-token`);
  assert(tokOff.status === 403, `/approver-token disabled by default -> 403 (got ${tokOff.status})`);

  // --- CORS preflight for the browser bubble --------------------------------
  const pre = await fetch(`${BASE}/chat`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
  });
  assert(pre.status === 204, `CORS preflight -> 204 (got ${pre.status})`);
  assert(pre.headers.get('access-control-allow-origin') === 'http://localhost:5173', 'preflight echoes the app origin');
```

- [ ] **Step 5: Run the full E2E**

Run: `npm run e2e`
Expected: all prior PLUS:
```
PASS  /approver-token disabled by default -> 403 (got 403)
PASS  CORS preflight -> 204 (got 204)
PASS  preflight echoes the app origin
```
ending `✅ E2E + GATE GREEN`.

- [ ] **Step 6: Commit**

```bash
git add packages/relay/src/server.ts scripts/e2e.mjs
git commit -m "feat: CORS + opt-in /approver-token for the in-app bubble"
```

---

### Task 4: `<ChatBubble>` component + feature flag

Add the bubble to `@grabmycursor/react`: `useChatRuntime` + `AssistantChatTransport` bound to the relay `/chat`, wrapped in `AssistantRuntimeProvider` and a modal (floating FAB). A small settings row sets `baseURL` + `model`, sent as extra body fields. Wire it behind a `chat` prop on `GrabMyCursorProvider` with a dynamic import so it costs nothing when off. This is UI — verification is manual (there is no headless assertion for rendered React here).

**Files:**
- Create: `packages/react/src/chat/ChatBubble.tsx`
- Modify: `packages/react/src/provider.tsx` (accept `chat` prop, dynamic-import the bubble)
- Modify: `packages/react/src/index.ts` (export `ChatBubbleConfig` type)
- Modify: `packages/react/package.json` (add assistant-ui deps)
- Modify: `apps/todo/src/App.tsx` (pass `chat` to the provider for manual verification)

**Interfaces:**
- Consumes: relay `POST /chat` (Task 2). The provider's existing `url` prop yields the http base via the existing `httpBaseFrom` helper.
- Produces: `interface ChatBubbleConfig { api?: string; baseURL?: string; model?: string }`; `<GrabMyCursorProvider chat={ChatBubbleConfig}>` renders the bubble; absent → nothing imported.

- [ ] **Step 1: Install assistant-ui deps into the react workspace**

Run:
```bash
npm i @assistant-ui/react @assistant-ui/react-ai-sdk -w @grabmycursor/react
```
Expected: both under `packages/react/package.json` `dependencies`.

- [ ] **Step 2: Confirm the runtime + modal exports**

Run:
```bash
node -e "import('@assistant-ui/react-ai-sdk').then(m=>console.log('ai-sdk:',['useChatRuntime','AssistantChatTransport'].filter(k=>k in m)))"
node -e "import('@assistant-ui/react').then(m=>console.log('react:',['AssistantRuntimeProvider','AssistantModalPrimitive','ThreadPrimitive','ComposerPrimitive','MessagePrimitive'].filter(k=>k in m)))"
```
Expected: `ai-sdk: [ 'useChatRuntime', 'AssistantChatTransport' ]` and the react line lists the four primitives. If any primitive name differs, fetch the current names via Context7 (`/assistant-ui/assistant-ui`, query "AssistantModalPrimitive ThreadPrimitive ComposerPrimitive exports") and use those in Step 3.

- [ ] **Step 3: Write `packages/react/src/chat/ChatBubble.tsx`**

A self-contained bubble built from unstyled primitives (no shadcn needed in a library) with minimal inline styles. `baseURL`/`model` live in local state and feed the transport via `useMemo`.

```tsx
// T-CB4 — in-app chat bubble. Binds assistant-ui to the relay /chat route (Arch A).
// Not a product: one more agent through the same gate. Session memory only (refresh clears it).
import { useMemo, useState } from 'react';
import { AssistantRuntimeProvider, AssistantModalPrimitive, ThreadPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react';
import { useChatRuntime, AssistantChatTransport } from '@assistant-ui/react-ai-sdk';

export interface ChatBubbleConfig {
  /** relay chat endpoint. Default http://127.0.0.1:7331/chat */
  api?: string;
  /** OpenAI-compatible base URL sent to the relay. Default LM Studio. */
  baseURL?: string;
  /** model id sent to the relay. */
  model?: string;
}

const DEFAULTS = {
  api: 'http://127.0.0.1:7331/chat',
  baseURL: 'http://127.0.0.1:1234/v1', // LM Studio preset
  model: 'qwen2.5-7b-instruct',
};

function Message() {
  return (
    <MessagePrimitive.Root style={{ padding: '6px 10px', fontSize: 14 }}>
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

export function ChatBubble(cfg: ChatBubbleConfig = {}) {
  const api = cfg.api ?? DEFAULTS.api;
  const [baseURL, setBaseURL] = useState(cfg.baseURL ?? DEFAULTS.baseURL);
  const [model, setModel] = useState(cfg.model ?? DEFAULTS.model);

  const transport = useMemo(
    () => new AssistantChatTransport({ api, body: { baseURL, model } }),
    [api, baseURL, model],
  );
  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantModalPrimitive.Root>
        <AssistantModalPrimitive.Anchor style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}>
          <AssistantModalPrimitive.Trigger
            style={{ width: 52, height: 52, borderRadius: '50%', background: '#6ee7a0', color: '#04140a', border: 'none', fontSize: 22, cursor: 'pointer', boxShadow: '0 6px 24px rgba(0,0,0,.35)' }}
            aria-label="Open chat"
          >
            ✦
          </AssistantModalPrimitive.Trigger>
        </AssistantModalPrimitive.Anchor>
        <AssistantModalPrimitive.Content
          style={{ position: 'fixed', bottom: 84, right: 20, width: 360, height: 480, background: '#141416', color: '#eaeaea', border: '1px solid #2a2a2e', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 1000 }}
        >
          <div style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid #2a2a2e' }}>
            <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="baseURL" style={{ flex: 2, background: '#0e0e10', color: '#9fe6b6', border: '1px solid #2a2a2e', borderRadius: 6, padding: '4px 6px', fontSize: 11 }} />
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model" style={{ flex: 1, background: '#0e0e10', color: '#9fe6b6', border: '1px solid #2a2a2e', borderRadius: 6, padding: '4px 6px', fontSize: 11 }} />
          </div>
          <ThreadPrimitive.Root style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ThreadPrimitive.Viewport style={{ flex: 1, overflowY: 'auto' }}>
              <ThreadPrimitive.Messages components={{ Message }} />
            </ThreadPrimitive.Viewport>
            <ComposerPrimitive.Root style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #2a2a2e' }}>
              <ComposerPrimitive.Input
                placeholder="Ask the agent…"
                style={{ flex: 1, background: '#0e0e10', color: '#eaeaea', border: '1px solid #2a2a2e', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
              />
              <ComposerPrimitive.Send
                style={{ background: '#6ee7a0', color: '#04140a', border: 'none', borderRadius: 6, padding: '6px 12px', fontWeight: 600, cursor: 'pointer' }}
              >
                Send
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </AssistantModalPrimitive.Content>
      </AssistantModalPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
```

Note: if Step 2 reported different primitive names (assistant-ui renames occasionally, e.g. `AssistantModalPrimitive.Anchor` may not exist), adapt to the names it printed — keep the same structure (FAB trigger → content panel → thread → composer).

- [ ] **Step 4: Add the `chat` prop + dynamic import in `provider.tsx`**

In `packages/react/src/provider.tsx`, add to the `GrabMyCursorProviderProps` interface (line ~125):

```ts
  /** T-CB4: mount the in-app chat bubble (optional, dynamic-imported → zero cost when absent). */
  chat?: import('./chat/ChatBubble.js').ChatBubbleConfig;
```

Add state + effect to the provider component body (alongside the existing `viz` effect), and render the bubble when loaded:

```tsx
  const [Bubble, setBubble] = useState<null | ((c: unknown) => JSX.Element)>(null);
  useEffect(() => {
    if (!chat) return;
    let cancelled = false;
    import('./chat/ChatBubble.js').then(({ ChatBubble }) => {
      if (!cancelled) setBubble(() => ChatBubble as (c: unknown) => JSX.Element);
    });
    return () => {
      cancelled = true;
    };
  }, [chat]);
```

Add `useState` to the React import at the top of the file (`import { useEffect, useState, type ReactNode } from 'react';`). Change the return to render the bubble:

```tsx
  return (
    <>
      {children}
      {Bubble ? <Bubble {...(chat as object)} /> : null}
    </>
  );
```

And add `chat` to the destructured props in the function signature.

- [ ] **Step 5: Export the config type from `index.ts`**

In `packages/react/src/index.ts`, add:

```ts
export type { ChatBubbleConfig } from './chat/ChatBubble.js';
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @grabmycursor/react`
Expected: exit 0. (If assistant-ui types complain about `JSX.Element`, import `type { ReactElement }` and use that.)

- [ ] **Step 7: Wire the bubble into the todo app for manual verification**

In `apps/todo/src/App.tsx`, find the `<GrabMyCursorProvider ...>` usage and add the `chat` prop:

```tsx
<GrabMyCursorProvider chat={{ baseURL: 'http://127.0.0.1:1234/v1', model: 'qwen2.5-7b-instruct' }}>
```

- [ ] **Step 8: Manual verification (LM Studio or any OpenAI-compatible endpoint running locally)**

Run in three terminals:
```bash
LLM_BASE_URL_ALLOWLIST=127.0.0.1,localhost npm run relay
npm run todo
# start LM Studio (or any OpenAI-compatible server) on 127.0.0.1:1234 with a model loaded
```
Open `http://localhost:5173`. Expected:
- A round ✦ FAB appears bottom-right.
- Clicking it opens a 360×480 panel with a baseURL/model row, a message list, and a composer.
- Typing "add a task called milk" and sending → the assistant calls `add_task` → **"milk" appears on the todo board**.
- Refreshing the page clears the chat (session memory only).

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/chat/ChatBubble.tsx packages/react/src/provider.tsx packages/react/src/index.ts packages/react/package.json package-lock.json apps/todo/src/App.tsx
git commit -m "feat: <ChatBubble> bound to relay /chat, feature-flagged (T-CB4)"
```

---

### Task 5: driver.js Approve/Deny in the spotlight (inline gate decision)

Extend `spotlight.ts` so that, when inline approval is enabled, the destructive "awaiting" popover renders **Approve** and **Deny** buttons via driver.js `onPopoverRender`. Clicking posts to the relay `/api/decide` with the approver token (fetched once from the opt-in `/approver-token` route). The relay still verifies the token and remains authoritative; the LLM has no tool to click the button, so AC-4 holds.

**Files:**
- Modify: `packages/react/src/spotlight.ts` (fetch approver token; add buttons in the `awaiting` state)
- Modify: `packages/react/src/provider.tsx` (pass the relay http base to `createSpotlight`)

**Interfaces:**
- Consumes: relay `GET /approver-token` and `POST /api/decide` (Tasks 3 / existing E1); the existing phase-event `gate`/`decided` flow; `active.id` (the lifecycle id, which equals the pending approval id — both come from the same `runGatedCall` `randomUUID`).
- Produces: `createSpotlight(approveUrl: string, decideBase?: string)` — when `decideBase` is set and `/approver-token` returns a token, the awaiting popover shows Approve/Deny; otherwise it keeps the current link-to-`/approve` behavior.

- [ ] **Step 1: Fetch the approver token (best-effort) in `createSpotlight`**

In `packages/react/src/spotlight.ts`, change the signature and add a token fetch. Replace `export function createSpotlight(approveUrl: string): Spotlight {` with:

```ts
export function createSpotlight(approveUrl: string, decideBase?: string): Spotlight {
  let approverToken: string | undefined;
  if (decideBase) {
    fetch(`${decideBase}/approver-token`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((j) => {
        approverToken = j?.token;
      })
      .catch(() => {});
  }
```

(Leave the rest of the function body as-is until Step 2.)

- [ ] **Step 2: Add Approve/Deny buttons to the awaiting popover**

The current `show()` helper calls `d.highlight(...)` with `showButtons: []`. Add an `onPopoverRender` that injects buttons only in the awaiting state. Replace the `show` function with this version (adds an optional `decision` flag):

```ts
  async function postDecide(id: string, approve: boolean) {
    if (!decideBase || !approverToken) return;
    await fetch(`${decideBase}/api/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-approver-token': approverToken },
      body: JSON.stringify({ id, approve }),
    }).catch(() => {});
  }

  function show(
    name: string,
    description: string,
    opts: { lock?: boolean; klass?: string; decide?: string } = {},
  ) {
    cancelClear();
    const decideId = opts.decide;
    d.setConfig({
      ...base,
      disableActiveInteraction: !!opts.lock,
      popoverClass: opts.klass ? `gmc-popover ${opts.klass}` : 'gmc-popover',
      onPopoverRender:
        decideId && approverToken
          ? (popover) => {
              const mk = (label: string, cls: string, approve: boolean) => {
                const b = document.createElement('button');
                b.innerText = label;
                b.className = `driver-popover-footer-btn gmc-decide ${cls}`;
                b.addEventListener('click', () => void postDecide(decideId, approve));
                popover.footerButtons.appendChild(b);
              };
              mk('Approve', 'gmc-approve', true);
              mk('Deny', 'gmc-deny', false);
            }
          : undefined,
    });
    d.highlight({
      element: resolveEl(name),
      popover: {
        title: `Agent · ${name}`,
        description,
        showButtons: [],
        side: 'top',
        align: 'center',
      },
    });
  }
```

- [ ] **Step 3: Pass the pending id into the awaiting popover**

In `spotlight.ts`, in the `case 'gate':` block, the `m.status === 'awaiting'` branch currently calls `show(active.name, ...pending..., { lock: true, klass: 'gmc-pending' })`. Change that call to include the decision id, and only show the link when inline buttons aren't available:

```ts
          if (m.status === 'awaiting') {
            const inline = !!decideBase && !!approverToken;
            show(
              active.name,
              `⏳ Waiting for owner approval…<br>${fidelity(active.preview)}` +
                (inline
                  ? ''
                  : `<a class="gmc-approve-link" href="${approveUrl}" target="_blank" rel="noopener">→ open approval page</a>`),
              { lock: true, klass: 'gmc-pending', decide: active.id },
            );
            say(`${active.name} needs owner approval — waiting`);
          } else {
```

- [ ] **Step 4: Add button styles**

In `spotlight.ts`, append to the `CSS` string (before the closing backtick):

```
.gmc-popover .gmc-decide{flex:1;font-size:13px;padding:5px 8px;border-radius:6px;cursor:pointer;border:1px solid #444}
.gmc-popover .gmc-approve{background:#183d1e;color:#7ee29a;border-color:#2a5}
.gmc-popover .gmc-deny{background:#3d1818;color:#ff8a8a;border-color:#a33}
```

- [ ] **Step 5: Pass the http base from the provider**

In `packages/react/src/provider.tsx`, in the `viz` effect, change the `createSpotlight` call to pass the decide base **only when inline approval should be attempted** (the token route decides). Replace:

```ts
      sp = createSpotlight(`${httpBaseFrom(url)}/approve`);
```

with:

```ts
      sp = createSpotlight(`${httpBaseFrom(url)}/approve`, httpBaseFrom(url));
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @grabmycursor/react`
Expected: exit 0.

- [ ] **Step 7: Manual verification**

Run the relay with inline approval enabled, plus the todo app and an LLM endpoint:
```bash
GMC_INLINE_APPROVAL=1 LLM_BASE_URL_ALLOWLIST=127.0.0.1,localhost npm run relay
npm run todo
```
In `apps/todo/src/App.tsx`, ensure the provider has `viz` on for this check: `<GrabMyCursorProvider viz chat={{...}}>`.
Open `http://localhost:5173`, open the bubble, ask "delete all my tasks". Expected:
- The spotlight highlights the delete-all control, popover shows `⏳ Waiting for owner approval…` with the canonical args and **Approve / Deny** buttons (no link, because inline is active).
- Clicking **Approve** → the action runs, tasks clear, popover shows `✅ Approved`.
- Repeat, click **Deny** → popover shows `⛔ Denied`, tasks unchanged, and the bubble's assistant sees the denial.
- Restart the relay **without** `GMC_INLINE_APPROVAL=1` → the awaiting popover shows the `→ open approval page` link again (buttons gone), confirming the default out-of-tab posture.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/spotlight.ts packages/react/src/provider.tsx
git commit -m "feat: driver.js Approve/Deny in the gate spotlight (opt-in inline approval)"
```

---

### Task 6: Docs + status update

Record the feature, its flags, and the guardrails so the next reader knows the bubble is optional and how to run it.

**Files:**
- Modify: `BUILD_STATUS.md` (add a T-CB row + flags)
- Modify: `docs/DEMO.md` (how to run the bubble; env vars)
- Modify: `README.md` (one line: optional in-app bubble, feature-flagged)

- [ ] **Step 1: Add a status row**

In `BUILD_STATUS.md`, in the task-status table (section 3), add a row:

```
| **T-CB0–CB7** In-app chat bubble (Arch A) | ✅ | `/chat` route reuses registry + `runGatedCall` (one gate); `<ChatBubble>` via `useChatRuntime`; key in relay env (`LLM_KEY`); baseURL allowlist; driver.js Approve/Deny opt-in (`GMC_INLINE_APPROVAL=1`); proven in `npm run e2e` (stub LLM). Off by default → zero bundle. |
```

- [ ] **Step 2: Document run + env in `docs/DEMO.md`**

Add a section:

```markdown
## In-app chat bubble (optional)

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
```

- [ ] **Step 3: One line in `README.md`**

Add under the feature list: `- Optional in-app chat bubble (feature-flagged) — one more agent through the same gate.`

- [ ] **Step 4: Commit**

```bash
git add BUILD_STATUS.md docs/DEMO.md README.md
git commit -m "docs: in-app chat bubble — flags, run steps, guardrails"
```

---

## Notes for the implementer

- **Do not** add a zustand store, a thread list, persistent history, RAG, or model routing. The moment any of these appears, stop — the bubble has become assistant-ui. Session memory (AI SDK in-memory messages) is the whole story.
- **One registry, one gate** is verified structurally: the chat route iterates `toolRegistry` and calls `runGatedCall`. If you find yourself defining a tool's behavior anywhere other than the app's `useWebMCP` declaration, or calling the browser without going through `runGatedCall`, you've broken the invariant.
- The lifecycle `id` from `runGatedCall` is the same id used for the pending approval, which is why the spotlight's `active.id` can be posted straight to `/api/decide`.
- assistant-ui primitive names drift between releases. Task 4 Step 2 and Task 4 Step 3's note are the guardrail — verify exports against the installed version (Context7) before trusting the JSX.
