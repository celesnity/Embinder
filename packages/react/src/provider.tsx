// GrabMyCursorProvider (T-B1) — installs a document.modelContext shim backed by the relay ws.
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
//  5. T-K: relay phase events (intent/gate/decided/call) are forwarded to an optional spotlight
//     listener; the driver.js spotlight is dynamically imported ONLY when viz is on.

import { useEffect, type ReactNode } from 'react';
import { getModelContext, type ModelContextSurface, type ToolDescriptor } from './model-context.js';
import type { PhaseMessage, Spotlight } from './spotlight.js'; // type-only: no driver.js at runtime

const DEFAULT_URL = 'ws://127.0.0.1:7331/app';
const PHASE_TYPES = new Set(['intent', 'gate', 'decided']);

interface Shim {
  modelContext: ModelContextSurface;
  setPhaseListener(fn: ((m: PhaseMessage) => void) | undefined): void;
}
let singleton: Shim | undefined;

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
  let phaseListener: ((m: PhaseMessage) => void) | undefined;

  const flush = () => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    for (const msg of outbox.splice(0)) ws.send(msg);
  };
  const send = (payload: unknown) => {
    outbox.push(JSON.stringify(payload));
    flush();
  };

  (async () => {
    let t = token;
    if (!t) {
      try {
        const r = await fetch(`${httpBaseFrom(url)}/app-token`);
        t = (await r.json()).token;
      } catch {
        console.warn('[grabmycursor] could not fetch /app-token — is the relay running?');
      }
    }
    const wsUrl = t ? `${url}?token=${encodeURIComponent(t)}` : url;
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', flush);
    ws.addEventListener('error', () =>
      console.warn('[grabmycursor] relay ws error — is the relay running on', url, '?'),
    );
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      // T-K: forward display-only phase events to the spotlight.
      if (PHASE_TYPES.has(m.type)) {
        phaseListener?.(m);
        return;
      }
      if (m.type !== 'call') return;
      phaseListener?.(m); // running
      Promise.resolve(tools.get(m.name)?.execute(m.args))
        .then((result) => {
          phaseListener?.({ type: 'done', id: m.id });
          send({ type: 'result', id: m.id, result });
        })
        .catch((error) => {
          phaseListener?.({ type: 'done', id: m.id });
          send({ type: 'result', id: m.id, error: String(error) });
        });
    });
  })();

  const modelContext: ModelContextSurface = {
    registerTool(descriptor, options) {
      tools.set(descriptor.name, descriptor);
      send({ type: 'register', tool: stripDescriptor(descriptor) });
      native?.registerTool(descriptor, options); // T-H1
      options?.signal?.addEventListener('abort', () => {
        tools.delete(descriptor.name);
        send({ type: 'unregister', name: descriptor.name });
      });
    },
  };

  return {
    modelContext,
    setPhaseListener(fn) {
      phaseListener = fn;
    },
  };
}

function ensureShim(url: string, token?: string): void {
  if (typeof window === 'undefined') return;
  if (singleton) return;
  const native = getModelContext();
  singleton = createShim(url, token, native);
  Object.defineProperty(document, 'modelContext', {
    value: singleton.modelContext,
    configurable: true,
  });
}

export interface GrabMyCursorProviderProps {
  children: ReactNode;
  /** Relay ws endpoint. Default ws://127.0.0.1:7331/app */
  url?: string;
  /** Optional explicit ws token (otherwise fetched from the relay, T-G1). */
  token?: string;
  /** T-K: enable the agent-action spotlight + gate visualization (D7 polish, off by default). */
  viz?: boolean;
}

export function GrabMyCursorProvider({ children, url = DEFAULT_URL, token, viz = false }: GrabMyCursorProviderProps) {
  ensureShim(url, token);

  // T-K: load the spotlight only when the flag is on (zero driver.js cost when off).
  useEffect(() => {
    if (!viz || !singleton) return;
    let sp: Spotlight | undefined;
    let cancelled = false;
    import('./spotlight.js').then(({ createSpotlight }) => {
      if (cancelled) return;
      sp = createSpotlight(`${httpBaseFrom(url)}/approve`);
      singleton!.setPhaseListener((m) => sp!.handle(m));
    });
    return () => {
      cancelled = true;
      singleton?.setPhaseListener(undefined);
      sp?.destroy();
    };
  }, [viz, url]);

  return <>{children}</>;
}
