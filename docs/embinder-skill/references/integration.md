# Integrating Embinder — wire the agent into a website (React path)

> **This is the React path.** For any other stack — Vue, Svelte, Angular, Solid, vanilla, SSR —
> and for the "land on an arbitrary app: detect → map → adapt → report" workflow, see
> **`platform-playbook.md`** (which uses `embinder-bridge.js`). The concepts below still apply;
> only the _declare_ and _wrap_ steps change.

This is the recipe for making a website's actions agent-callable, and gated. Every snippet is
copied from the live reference app (`apps/todo`) so it matches the source. Do the same in your
own React app.

The whole loop is: **wrap → declare → anchor → policy → point the agent → see & gate.**

---

## 1. Wrap the app in `EmbinderProvider`

Wrap your React tree once, at the root. From `apps/todo/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EmbinderProvider } from "@embinder/react";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EmbinderProvider url="ws://127.0.0.1:7331/app" viz chat={{}}>
      <App />
    </EmbinderProvider>
  </StrictMode>,
);
```

Configure `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_KEY` beside the relay. Keep model endpoints and
keys out of product code unless the deployment explicitly requires an override.

`EmbinderProviderProps`:

- `url?` — relay ws endpoint (default `ws://127.0.0.1:7331/app`).
- `token?` — explicit app token; otherwise fetched from the relay's `GET /app-token`.
- `viz?` — enable the driver.js action spotlight (default `false`; code-split, zero cost off).
- `chat?` — a `ChatBubbleConfig` (`{ api?, baseURL?, model? }`) that mounts the in-app chat
  bubble (dynamic-imported).

Why it must be the provider (not manual setup): it installs the `document.modelContext` shim
**during render**, so your child components' `useWebMCP` calls see it. There is **no `<script>`
tag** — it's an ESM React import.

## 2. Declare each action with `useWebMCP`

One `useWebMCP({...})` call per agent-callable action. The `inputSchema` is a **Zod raw shape**
(an object of validators, or `{}` for no args) — not a wrapped `z.object(...)`. From
`apps/todo/src/App.tsx`:

```tsx
import { z } from "zod";
import { useWebMCP, grabAnchor } from "@embinder/react";

useWebMCP({
  name: "add_task",
  description: "Add a new task to the board",
  inputSchema: { text: z.string().describe("Task text") },
  annotations: { title: "Add task" },
  handler: async ({ text }: { text: string }) => {
    dispatch({ type: "ADD", text });
    return { ok: true, added: text };
  },
});

useWebMCP({
  name: "delete_task",
  description: "Delete a single task by id",
  inputSchema: { id: z.string() },
  annotations: { title: "Delete task", destructiveHint: true },
  handler: async ({ id }: { id: string }) => {
    dispatch({ type: "DELETE", id });
    return { ok: true, id };
  },
});
```

Tool-definition fields:

- `name` — unique tool id; **must match the name in `embinder.policy.json`**.
- `description` — the natural-language description the agent reads.
- `inputSchema` — Zod raw shape.
- `annotations` — `{ title, readOnlyHint?, destructiveHint? }`. `destructiveHint: true` is only a
  _default_ risk hint; the server policy overrides it.
- `handler` — the async function that performs the real UI action (here, dispatch to the app's
  reducer). Its return value becomes the tool result the agent sees. **The handler runs in the
  browser and never leaves it.**

**Read live state via a ref**, not from closure, so handlers don't force re-registration
(`apps/todo/src/App.tsx`):

```tsx
const tasksRef = useRef<Task[]>(tasks);
tasksRef.current = tasks;
// ...
handler: async () => ({ tasks: tasksRef.current }),
```

## 3. Anchor each tool to its DOM element

Spread `grabAnchor(name)` onto the element the tool drives, so the spotlight can highlight and
lock it. `grabAnchor` just stamps a `data-embinder-tool` attribute (`apps/todo/src/App.tsx`):

```tsx
<button {...grabAnchor('add_task')} onClick={add}>Add</button>
<button className="danger" {...grabAnchor('delete_all_tasks')} onClick={() => dispatch({ type: 'CLEAR' })}>
  Clear all
</button>
```

Embinder does **not** scrape or drive arbitrary DOM — the app author explicitly binds each tool
to its owning element. (Anchoring is only needed for the spotlight; the tool still works without
it, just without the visual highlight.)

## 4. Declare risk in `embinder.policy.json`

The **authoritative** per-tool risk lives in the root `embinder.policy.json` — this, not the
app's `destructiveHint`, decides what pauses. Current file:

```json
{
  "$comment": "Authoritative per-tool risk policy. Wins over first-party destructiveHint. Unknown tools deny-by-default.",
  "unknownTool": "destructive",
  "tools": {
    "__gmc_ready": "read",
    "list_tasks": "read",
    "add_task": "write",
    "toggle_task": "write",
    "edit_task": "write",
    "delete_task": "destructive",
    "delete_all_tasks": "destructive"
  },
  "rateLimit": { "perToolPerMin": 30 }
}
```

- `read` / `write` → pass through the gate automatically.
- `destructive` → **pauses for out-of-tab human approval**.
- `unknownTool: "destructive"` → any tool not listed is deny-by-default (pauses).
- `rateLimit.perToolPerMin` → per-`session:tool` cap enforced in the gate.

Add every new tool here. A tool you declare with `useWebMCP` but forget to list will be treated
as `destructive` (safe default) and always pause. Keep `__gmc_ready: "read"` — it's the internal
primer tool.

## 5. Point the agent at the relay

External MCP clients (LM Studio, Claude, MCP Inspector) connect to the relay's `/mcp` endpoint.
Root `mcp.json`:

```json
{ "mcpServers": { "embinder": { "url": "http://127.0.0.1:7331/mcp" } } }
```

The relay must be running (`npm run dev`, or `npm run relay` for the relay alone). Each MCP
session gets its own `McpServer`, so multiple clients can connect at once.

## 6. (Optional) In-app chat bubble

Pass `chat` to the provider (step 1). The bubble talks to the relay's `/chat` route, which runs
the LLM loop server-side and routes every tool call through **the same gate** as external agents.
Relay-side env:

- `LLM_KEY` — API key, kept server-side (never sent to the browser).
- `LLM_BASE_URL_ALLOWLIST` — hosts the browser-supplied `baseURL` may point at (default
  `127.0.0.1,localhost`) — an SSRF / key-exfil guard.

## 7. See it, and gate it

- **Spotlight (in-tab):** with `viz`, the driven element highlights on `intent`, **locks** while
  awaiting approval, and shows inline **Approve/Deny buttons** in a popover. Display-only highlight.
- **Inline approval (on screen):** destructive calls pause and show inline Approve/Deny buttons in
  the app tab. The approver sees the exact canonical bytes (hidden / zero-width Unicode stripped).
  This is the default and only path — the agent cannot reach the approver token.
- **Audit:** every call lands in `audit.jsonl` (`ts, session, tool, argsRaw, argsCanonical,
decision, approver, latencyMs`).

---

## Adapting to another app or another framework

The general pattern (any app):

1. **One tool per meaningful action.** Verb-named (`add_task`, `delete_task`), matching the
   policy exactly.
2. **Handler does the real thing** — call your existing state update / API / mutation. Return a
   small JSON result the agent can read. Keep live reads current (a ref in React; a store/
   signal/ref elsewhere).
3. **Anchor the owning element** (`grabAnchor` in React, or the `data-embinder-tool` attribute
   directly) so the spotlight can point at it.
4. **Classify risk honestly** in `embinder.policy.json`: reads → `read`, non-destructive writes →
   `write`, anything irreversible/dangerous → `destructive` (pauses). When unsure, leave it
   unlisted — deny-by-default makes it pause.

**Not a React app?** Follow **`platform-playbook.md`** and use `embinder-bridge.js`. One warning
that bites React devs going direct-wire:

> **`inputSchema` on the wire is JSON Schema, not a Zod raw shape.** In React you write
> `inputSchema: { text: z.string() }` and `useWebMCP` converts it. Talking to the relay directly
> (or via the bridge) you must send
> `{ type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }` — the relay's
> `toZodShape` reads only `properties`/`required`. Send the Zod form direct-wire and the tool
> registers with an empty/broken schema, silently.

---

## Verify your integration

Do not stop at the SDK baseline. Follow the complete capability-matrix and real-browser loop in
`platform-playbook.md`.

- Run the target product's format/lint, typecheck, build, and existing tests.
- Run `npm run e2e` for the relay protocol, gate, security, context, and chat baseline.
- In the target's served browser page, prove connection/readiness, page-scoped registration,
  context, navigation, every declared action, persistence after refresh, and handler errors.
- Prove destructive denial without mutation and approval with exactly one mutation; confirm audit.
- Verify mascot, ghost cursor, spotlight, waiting/approved/denied/running/done phases, responsive
  layout, and reduced motion on the target platform.
- Test product-before-relay, relay restart, route changes, login/logout, and the served CSP/CORS/
  Origin headers.
- Keep iterating until every capability-matrix row passes or has an evidenced rights blocker.
