// embinder-bridge.js — the framework-agnostic Embinder browser bridge.
//
// This is the ONE integration path for any web frontend that is NOT React
// (Vue, Svelte, Angular, Solid, vanilla, SSR-hydrated). React apps use
// <EmbinderProvider> from @embinder/react instead — see integration.md.
//
// It is a faithful reduction of `createShim` + `ensureShim` in
// packages/react/src/provider.tsx, with the React parts removed (no hooks, no
// JSX, no StrictMode singleton timing, no spotlight/chat). Nothing about the
// Embinder protocol requires React — the relay's ws `/app` handler
// (packages/relay/src/server.ts) dispatches on a bare `m.type` switch and never
// inspects the framework. The wire protocol IS the entire API.
//
// ── THE #1 CORRECTNESS LANDMINE ──────────────────────────────────────────────
// On the wire, `inputSchema` must be JSON SCHEMA, e.g.
//     { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
// because the relay converts it with `toZodShape` (server.ts), which only reads
// `properties` / `required`. The React path writes a Zod raw shape
// ( { text: z.string() } ) ONLY because `useWebMCP` converts it for you.
// A direct-wire client that sends the Zod form registers a BROKEN schema and
// fails silently. Send JSON Schema here.
// ─────────────────────────────────────────────────────────────────────────────
//
// Works in a browser (global WebSocket/fetch) and in Node >= 22 (which also has
// global WebSocket + fetch), so it can be imported by an end-to-end test.

const DEFAULT_URL = 'ws://127.0.0.1:7331/app';

// Display-only phase events the relay may push to the app tab. A headless bridge
// ignores them; a UI can hook them for a spotlight. (Mirrors PHASE_TYPES in provider.tsx.)
const PHASE_TYPES = new Set(['intent', 'gate', 'decided', 'done']);

// ws://…/app  ->  http://…    (mirrors httpBaseFrom in provider.tsx)
function httpBaseFrom(wsUrl) {
  return wsUrl.replace(/^ws/, 'http').replace(/\/app$/, '');
}

// The exact JSON that goes over the wire in a `register` message. The handler
// (`execute`) is deliberately NOT sent — it stays in the browser. (= stripDescriptor.)
function stripDescriptor(d) {
  return {
    name: d.name,
    title: d.title,
    description: d.description,
    inputSchema: d.inputSchema, // JSON Schema — see landmine above
    annotations: d.annotations, // { title?, readOnlyHint?, destructiveHint? }
  };
}

/**
 * Install the Embinder relay bridge once, at app load.
 *
 * @param {object} [opts]
 * @param {string} [opts.url]          Relay ws endpoint. Default ws://127.0.0.1:7331/app
 * @param {string} [opts.token]        Explicit app token; otherwise fetched from GET /app-token.
 * @param {boolean} [opts.exposeGlobal] Also install as `document.modelContext` (W3C WebMCP
 *                                       surface) so standards code finds it. Default true in a
 *                                       browser, ignored where `document` is absent (Node).
 * @returns {{ registerTool: Function, close: Function, whenOpen: Promise<void> }}
 */
export function installEmbinderBridge(opts = {}) {
  const url = opts.url || DEFAULT_URL;
  const exposeGlobal = opts.exposeGlobal !== false;

  const tools = new Map();   // name -> { ...descriptor, execute }
  const outbox = [];         // buffered until the socket opens
  let ws;

  const flush = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      for (const msg of outbox.splice(0)) ws.send(msg);
    }
  };
  const send = (payload) => {
    outbox.push(JSON.stringify(payload));
    flush();
  };

  // Open the socket (token fetched async if not supplied), buffering registrations meanwhile.
  const whenOpen = (async () => {
    let t = opts.token;
    if (!t) {
      try {
        const r = await fetch(`${httpBaseFrom(url)}/app-token`);
        t = (await r.json()).token;
      } catch {
        console.warn('[embinder] could not fetch /app-token — is the relay running?');
      }
    }
    const wsUrl = t ? `${url}?token=${encodeURIComponent(t)}` : url;
    ws = new WebSocket(wsUrl);

    ws.addEventListener('open', flush);
    ws.addEventListener('error', () =>
      console.warn('[embinder] relay ws error — is the relay running on', url, '?'),
    );
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data));
      if (PHASE_TYPES.has(m.type)) return; // display-only; ignore in a headless bridge
      if (m.type !== 'call') return;
      // Run the local handler and post the result back (or the error).
      Promise.resolve(tools.get(m.name)?.execute(m.args))
        .then((result) => send({ type: 'result', id: m.id, result }))
        .catch((error) => send({ type: 'result', id: m.id, error: String(error) }));
    });

    await new Promise((resolve) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();
      ws.addEventListener('open', () => resolve(), { once: true });
    });
  })();

  // The registration surface (= the shim's modelContext.registerTool).
  const registerTool = (descriptor) => {
    // descriptor: { name, title?, description?, inputSchema? (JSON Schema),
    //               annotations?, execute(args) -> result|Promise }
    tools.set(descriptor.name, descriptor);
    send({ type: 'register', tool: stripDescriptor(descriptor) });
    return {
      // Call to remove the tool (sends `unregister`).
      unregister() {
        tools.delete(descriptor.name);
        send({ type: 'unregister', name: descriptor.name });
      },
    };
  };

  // Standards compatibility: expose as document.modelContext (as Embinder does via
  // Object.defineProperty in ensureShim). The relay only needs the wire messages.
  if (exposeGlobal && typeof document !== 'undefined') {
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool: (d) => registerTool(d) },
      configurable: true,
    });
  }

  return {
    registerTool,
    whenOpen,
    close() { try { ws?.close(); } catch { /* ignore */ } },
  };
}

export default installEmbinderBridge;
