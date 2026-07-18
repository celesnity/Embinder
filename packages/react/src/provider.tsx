// MinderProvider (T-B1) — installs a document.modelContext shim backed by the relay ws.
// Tools registered via useWebMCP flow straight through this shim into the server-side gate.
//
// Two things this file gets deliberately right:
//  1. The shim is installed during PROVIDER RENDER, not in an effect. React runs child
//     effects before parent effects, so a useEffect here would install document.modelContext
//     AFTER the child's useWebMCP already tried to read it — tools would never register.
//  2. The ws + shim are a MODULE-SCOPE SINGLETON, so React StrictMode's mount→unmount→mount
//     can't close the socket and leave it dead. The socket lives for the page lifetime.

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

function createShim(url: string, token?: string): Shim {
  const wsUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
  const ws = new WebSocket(wsUrl);
  const tools = new Map<string, ToolDescriptor>();

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.type !== 'call') return;
    Promise.resolve(tools.get(m.name)?.execute(m.args))
      .then((result) => ws.send(JSON.stringify({ type: 'result', id: m.id, result })))
      .catch((error) => ws.send(JSON.stringify({ type: 'result', id: m.id, error: String(error) })));
  });
  ws.addEventListener('error', () => {
    // Surfaced in the browser console; relay may just not be up yet.
    console.warn('[minder] relay ws error — is the relay running on', url, '?');
  });

  const send = (payload: unknown) => {
    const data = JSON.stringify(payload);
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
    else ws.addEventListener('open', () => ws.send(data), { once: true });
  };

  const modelContext: ModelContextSurface = {
    registerTool(descriptor, options) {
      tools.set(descriptor.name, descriptor);
      send({ type: 'register', tool: stripDescriptor(descriptor) });
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
  if (getModelContext()) return; // native WebMCP surface or our shim already present (T-H1 degrade)
  if (!singleton) singleton = createShim(url, token);
  Object.defineProperty(document, 'modelContext', {
    value: singleton.modelContext,
    configurable: true,
  });
}

export interface MinderProviderProps {
  children: ReactNode;
  /** Relay ws endpoint. Default ws://127.0.0.1:7331/app */
  url?: string;
  /** One-time loopback token minted by the relay (T-G1). */
  token?: string;
}

export function MinderProvider({ children, url = DEFAULT_URL, token }: MinderProviderProps) {
  // Install during render — runs before child useWebMCP effects. Idempotent + singleton-backed.
  ensureShim(url, token);
  return <>{children}</>;
}
