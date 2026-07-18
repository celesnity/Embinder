# Platform playbook — integrating the agent into ANY web platform

This is the operating procedure for an agent that lands on an arbitrary web app and must make
its actions agent-callable through Embinder. Follow the stages in order and **produce the stated
artifacts** (stack verdict → platform map → wiring → bottleneck report).

**Why this works on any framework:** Embinder's browser side is framework-agnostic. The React
package (`@embinder/react`) is only *packaging*; the real bridge is `createShim` / `ensureShim`
in `packages/react/src/provider.tsx`, pure DOM/JS. The relay's ws `/app` handler in
`packages/relay/src/server.ts` dispatches on a bare `m.type` switch and never inspects the
framework. **The wire protocol is the entire API.** `scripts/e2e.mjs` is itself a non-React ws
client "playing a fake browser" — living proof the claim is real, not aspirational.

**The honesty boundary (do not soften):** "any platform" means **any web frontend with a live
DOM + JS runtime + a WebSocket it can open to the relay**. Non-web targets — native mobile, CLI,
pure backend — **cannot** be driven, because WebMCP lives in the browser (`document.modelContext`).
If the target is non-web, that is not a failure to push through; it is the top category of the
bottleneck report (Stage 4).

---

## Stage 0 — Can Embinder drive this target at all? (the gate)

Answer these before writing any code. Any "no" → skip to Stage 4 and emit a bottleneck report;
do not fake an integration.

- Is it a **web frontend** rendered in a browser with a live DOM? (Not native, not CLI, not a
  pure API.)
- Does it run **JavaScript in the page** at runtime? (A purely server-rendered page with no
  client JS has nothing to host the bridge.)
- Can the page open a **`WebSocket` to `ws://127.0.0.1:7331/app`**? (Blocked by a CSP
  `connect-src` directive or a sandboxed iframe → no.)
- Is the page's **Origin** acceptable to the relay? `originAllowed` in
  `packages/relay/src/security.ts` allows loopback dev origins (`:5173`) and treats an **absent**
  Origin as trusted. A different Origin must be added to `ALLOWED_ORIGINS`.

## Stage 1 — Detect the tech/language (read, don't vibe)

Determine what the platform is built in by **reading**, then state a one-line "stack verdict"
before proceeding.

| Look at | Tells you |
|---|---|
| `package.json` deps + lockfile | `react` / `vue` / `svelte` / `@angular/core` / `solid-js` / none (vanilla) |
| Build config | `vite.config.*`, `next.config.*`, `nuxt.config.*`, `svelte.config.*`, `angular.json`, `webpack.config.*` |
| `index.html` `<script type=...>` | ESM app entry vs classic script vs framework bootstrap |
| `.ts`/`.tsx` presence, `tsconfig.json` | TypeScript vs plain JS |
| SSR markers (`next`, `nuxt`, `@remix-run`, `astro`) | **SPA vs SSR** — the factor that most changes the approach (SSR: wire the bridge into the *client* hydration entry, not the server render) |

**Artifact — Stack verdict.** One line, e.g.: *"Vue 3 + Vite SPA, TypeScript, client-only;
mount entry `src/main.ts`."*

## Stage 2 — Map the platform structure

Before wiring, map the platform and record it. This is what "define the structure of the platform
the agent has to work on" means in practice.

**Artifact — Platform map.** For the target, capture:
1. **Entry / mount point** — where the app boots on the client (the one place the bridge installs
   once). React `main.tsx`; Vue `main.ts`; Svelte `main.js`; Angular `main.ts`; vanilla the
   `<script type="module">`. SSR → the *client* entry that hydrates.
2. **Candidate actions** — the user-meaningful actions worth exposing as tools (add/edit/delete/
   search/navigate/submit…). One tool per action.
3. **Where each action's logic lives** — the event handler / store action / service method / API
   call the tool's `execute` should invoke. Reuse it; don't reimplement it.
4. **Owning DOM element** — the element to anchor each tool to (for the spotlight), stamped with
   the framework-neutral `data-embinder-tool="<name>"` attribute (what `grabAnchor` does).
5. **Current-state access** — how a handler reads *live* state without a stale closure (framework
   detail — see the delta table below).
6. **Routes** — for an SPA, which routes each action is valid on.

## Stage 3 — Adapt immediately

One verifiable path plus a two-column per-framework delta. Do **not** invent a bespoke recipe per
framework — everything non-React uses the same bridge.

### React
Use the shipped binding: wrap in `<EmbinderProvider>`, declare with `useWebMCP`, anchor with
`grabAnchor`. Full recipe in **`integration.md`**.

### Everything else (Vue / Svelte / Angular / Solid / vanilla / SSR-hydrated)
Use **`embinder-bridge.js`** (in this folder). At the client entry, once:

```js
import { installEmbinderBridge } from './embinder-bridge.js';

const embinder = installEmbinderBridge({ url: 'ws://127.0.0.1:7331/app' }); // token auto-fetched

embinder.registerTool({
  name: 'add_task',
  description: 'Add a new task to the board',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  annotations: { title: 'Add task' },                 // destructiveHint optional; policy is authoritative
  execute: async ({ text }) => { addTask(text); return { ok: true, added: text }; },
});
```

- **Install once**, at the client entry, before/at mount.
- **One `registerTool` per action**; its `execute` calls your existing action logic and returns a
  small JSON result the agent reads. The handler runs in the page and never leaves it.
- **Anchor** the owning element with `data-embinder-tool="add_task"` (plain attribute — spread it
  in React, bind it in Vue/Svelte/Angular, set it in vanilla). Only needed for the spotlight.

> **⚠ The #1 correctness landmine — `inputSchema` is JSON Schema on the wire, not a Zod shape.**
> Send `{ type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }`.
> The relay converts it with `toZodShape` (`server.ts`), which reads only `properties`/`required`.
> The React path writes `{ text: z.string() }` **only because `useWebMCP` converts it for you.**
> A direct-wire client that sends the Zod form registers an **empty/broken** schema and fails
> silently. (Proven: a Zod-style schema registers with no `text` param; the JSON-Schema form
> registers it correctly.)

**Per-framework delta — only two things actually differ:**

| Stack | Where to install the bridge | How a handler reads current state |
|---|---|---|
| Vanilla | the `<script type="module">` entry | a module-scoped variable |
| Vue 3 | `main.ts`, after `createApp(...).mount()` | `store.state` / `ref.value` / Pinia getter (reactive, always current) |
| Svelte | `main.js` app entry | `get(store)` from `svelte/store` |
| Angular | `main.ts` or an `APP_INITIALIZER` | inject the service and read its current value |
| Solid | the root entry | a signal getter `count()` |
| SSR (Next/Nuxt/Astro) | the **client** entry / a client-only component (`useEffect`, `onMounted`, `client:only`) | the client store/state — never server render state |

> Reuse note: `@mcp-b/global` (v4, ships an IIFE build) provides the *standard* WebMCP surface,
> but it targets a browser-extension transport over postMessage — **not** the Embinder relay. For
> Embinder you want the relay bridge (`embinder-bridge.js`), not the vanilla polyfill transport.

Finally, **declare risk in `embinder.policy.json`** for every tool name (see `integration.md`
step 4) — `read`/`write` pass, `destructive` pauses, and any name you forget is deny-by-default
(pauses for approval).

## Stage 4 — Bottleneck report (when it can't wire an action)

When an action can't be wired, **emit a report instead of silently half-integrating**. Work
per-action: report the ones you're stuck on, keep wiring the rest. Ground each blocker in a real
Embinder requirement so it's actionable.

**Categories (the "why"):**
1. **Non-web / no `document.modelContext` reachable** — native app, CLI, backend-only. The hard
   stop (Stage 0). WebMCP is a browser surface.
2. **No WebSocket-to-loopback** — CSP `connect-src` blocks `ws://127.0.0.1:7331`, or a sandboxed
   iframe.
3. **Origin off the relay allowlist** — `originAllowed` rejects the page's Origin; needs adding to
   `ALLOWED_ORIGINS` (`security.ts`).
4. **No stable element to anchor** — canvas/WebGL/imperative-drawn UI with no DOM element for
   `data-embinder-tool`. (Tool can still work; spotlight can't highlight it.)
5. **Action logic unreachable from JS** — server-only route, a `<form>` POST that triggers a full
   page reload, or SSR output with no client handler to call.
6. **State unreadable without a re-render** — no ref/store/signal equivalent to read live state
   from inside `execute`.
7. **Tool name absent from `embinder.policy.json`** — deny-by-default → the call pauses for
   approval. A config gap, not a true blocker (fix: add it to the policy).

**Report template (markdown):**

```md
### Embinder integration bottleneck report

**Target:** <app name> · **Stack:** <stack verdict> · **Wired: N/M actions**

| Action / function | Category | Why stuck | Needed to unblock | Severity |
|---|---|---|---|---|
| `export_pdf` | 5 action-unreachable | fires a server form-POST that full-reloads; no JS handler to call | expose a client-side export fn, or move to an XHR endpoint | blocker |
| `pan_map` | 4 no-anchor | Leaflet canvas, no DOM element per control | wire the tool without a spotlight anchor (works, just unhighlighted) | minor |
```

**JSON variant** (for machine consumers):

```json
{
  "target": "<app>", "stack": "<stack verdict>", "wired": 4, "total": 6,
  "bottlenecks": [
    { "action": "export_pdf", "category": "action-unreachable",
      "why": "server form-POST full-reload; no JS handler", "unblock": "expose client export fn",
      "severity": "blocker" }
  ]
}
```

---

## Verify your integration

The same checks as the React path, plus one that proves the bridge itself:
- **Round-trip:** start the relay (`npm run relay`), load the app, connect an MCP client
  (`mcp.json`) or the chat bubble, and confirm a `write` executes immediately and a `destructive`
  action pauses at `http://127.0.0.1:7331/approve`.
- **Bridge proof (headless):** the bridge in this folder is verified against a live relay by a
  Node ws client that imports the exact file, registers a JSON-Schema tool, and drives
  `register → call → result` — mirroring `scripts/e2e.mjs`. Read that script to see the protocol
  in motion.
