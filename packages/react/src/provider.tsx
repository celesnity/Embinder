// MinderProvider (T-B1) — installs a document.modelContext shim backed by the relay ws.
// Tools registered via useWebMCP flow straight through this shim into the server-side gate.
//
// Deliberate correctness:
//  1. The shim is installed during PROVIDER RENDER, not in an effect. React runs child effects
//     before parent effects, so a useEffect here would install document.modelContext AFTER the
//     child's useWebMCP already read it — tools would never register.
//  2. The ws + shim are a MODULE-SCOPE SINGLETON, so React StrictMode's mount→unmount→mount
//     can't close the socket and leave it dead. The socket lives for the page lifetime.
//  3. Registrations buffer in an outbox until the socket opens (token is fetched async, T-G1).
//  4. T-H1: if a native WebMCP surface exists, registrations mirror to it too.

import type { ReactNode } from 'react';
import { getModelContext, type ModelContextSurface, type ToolDescriptor } from './model-context.js';

const DEFAULT_URL = 'ws://127.0.0.1:7331/app';

interface Shim {
  modelContext: ModelContextSurface;
}
let singleton: Shim | undefined;

// Meta sent to the relay (execute stays local — only its signature crosses the wire).
function stripDescriptor(d: ToolDescriptor) {
  return {
    name: d.name,
    title: d.title,
    description: d.description,
    inputSchema: d.inputSchema,
    annotations: d.annotations,
  };
}

function httpBaseFrom(wsUrl: string): string {
  return wsUrl.replace(/^ws/, 'http').replace(/\/app$/, '');
}

function createShim(url: string, token: string | undefined, native: ModelContextSurface | undefined): Shim {
  const tools = new Map<string, ToolDescriptor>();
  const outbox: string[] = [];
  let ws: WebSocket | undefined;

  const flush = () => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    for (const msg of outbox.splice(0)) ws.send(msg);
  };
  const send = (payload: unknown) => {
    outbox.push(JSON.stringify(payload));
    flush();
  };

  // Resolve the token (prop wins; otherwise fetch from the relay), then open the socket.
  (async () => {
    let t = token;
    if (!t) {
      try {
        const r = await fetch(`${httpBaseFrom(url)}/app-token`);
        t = (await r.json()).token;
      } catch {
        console.warn('[minder] could not fetch /app-token — is the relay running?');
      }
    }
    const wsUrl = t ? `${url}?token=${encodeURIComponent(t)}` : url;
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', flush);
    ws.addEventListener('error', () =>
      console.warn('[minder] relay ws error — is the relay running on', url, '?'),
    );
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.type !== 'call') return;
      Promise.resolve(tools.get(m.name)?.execute(m.args))
        .then((result) => send({ type: 'result', id: m.id, result }))
        .catch((error) => send({ type: 'result', id: m.id, error: String(error) }));
    });
  })();

  const modelContext: ModelContextSurface = {
    registerTool(descriptor, options) {
      tools.set(descriptor.name, descriptor);
      send({ type: 'register', tool: stripDescriptor(descriptor) });
      native?.registerTool(descriptor, options); // T-H1: mirror to native surface if present
      options?.signal?.addEventListener('abort', () => {
        tools.delete(descriptor.name);
        send({ type: 'unregister', name: descriptor.name });
      });
    },
  };

  return { modelContext };
}

// Idempotent install — safe to call on every render.
function ensureShim(url: string, token?: string): void {
  if (typeof window === 'undefined') return;
  if (singleton) return; // already installed this page
  const native = getModelContext(); // capture a native WebMCP surface before we overwrite (T-H1)
  singleton = createShim(url, token, native);
  Object.defineProperty(document, 'modelContext', {
    value: singleton.modelContext,
    configurable: true,
  });
}

export interface MinderProviderProps {
  children: ReactNode;
  /** Relay ws endpoint. Default ws://127.0.0.1:7331/app */
  url?: string;
  /** Optional explicit ws token (otherwise fetched from the relay, T-G1). */
  token?: string;
}

export function MinderProvider({ children, url = DEFAULT_URL, token }: MinderProviderProps) {
  // Install during render — runs before child useWebMCP effects. Idempotent + singleton-backed.
  ensureShim(url, token);
  return <>{children}</>;
}
