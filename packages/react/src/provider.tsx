// EmbinderProvider (T-B1) — installs a document.modelContext shim backed by the relay ws.
// Capabilities registered via useEmbinder flow straight through this shim into the gate.
//
// Deliberate correctness:
//  1. The shim is installed during PROVIDER RENDER, not in an effect. React runs child effects
//     before parent effects, so a useEffect here would install document.modelContext AFTER the
//     child's useEmbinder already read it — capabilities would never register.
//  2. The ws + shim are a MODULE-SCOPE SINGLETON, so React StrictMode's mount→unmount→mount
//     can't close the socket and leave it dead. The socket lives for the page lifetime.
//  3. Registrations buffer in an outbox until the socket opens (token is fetched async, T-G1).
//  4. T-H1: if a native WebMCP surface exists, registrations mirror to it too.
//  5. T-K: relay phase events (intent/gate/decided/call) are forwarded to an optional spotlight
//     listener; the driver.js spotlight is dynamically imported ONLY when viz is on.

import { useEffect, useState, type ReactNode, type ReactElement } from 'react';
import { getModelContext, type ModelContextSurface, type ToolDescriptor } from './model-context.js';
import { installActionTools } from './actions/registerActionTools.js';
import type { PhaseMessage, Spotlight } from './spotlight.js'; // type-only: no driver.js at runtime

const DEFAULT_URL = 'ws://127.0.0.1:7331/app';
const PHASE_TYPES = new Set(['intent', 'gate', 'decided', 'focus']);

interface Shim {
  modelContext: ModelContextSurface;
  setPhaseListener(fn: ((m: PhaseMessage) => void) | undefined): void;
  sendContext(name: string, state: unknown): void;
  registerScope(scope: { id: string; parentId?: string; name: string }): void;
  sendScopeContext(id: string, state: unknown): void;
  unregisterScope(id: string): void;
}
let singleton: Shim | undefined;

// Internal: bound-state snapshots from useEmbinder ride the same socket (D-4).
export function sendEmbinderContext(name: string, state: unknown): void {
  singleton?.sendContext(name, state);
}
export function registerEmbinderScope(scope: { id: string; parentId?: string; name: string }): void { singleton?.registerScope(scope); }
export function sendEmbinderScopeContext(id: string, state: unknown): void { singleton?.sendScopeContext(id, state); }
export function unregisterEmbinderScope(id: string): void { singleton?.unregisterScope(id); }

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
  const contexts = new Map<string, unknown>();
  const scopes = new Map<string, { id: string; parentId?: string; name: string }>();
  const scopeContexts = new Map<string, unknown>();
  const outbox: string[] = [];
  let ws: WebSocket | undefined;
  let phaseListener: ((m: PhaseMessage) => void) | undefined;
  let opened = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    for (const msg of outbox.splice(0)) ws.send(msg);
  };
  const send = (payload: unknown) => {
    outbox.push(JSON.stringify(payload));
    flush();
  };

  const connect = async () => {
    let t = token;
    if (!t) {
      try {
        const r = await fetch(`${httpBaseFrom(url)}/app-token`);
        t = (await r.json()).token;
      } catch {
        console.warn('[embinder] could not fetch /app-token — is the relay running?');
      }
    }
    const wsUrl = t ? `${url}?token=${encodeURIComponent(t)}` : url;
    const next = new WebSocket(wsUrl);
    ws = next;
    next.addEventListener('open', () => {
      if (opened) {
        for (const scope of scopes.values()) send({ type: 'scope-register', scope });
        for (const [id, state] of scopeContexts) send({ type: 'scope-context', id, state });
        for (const descriptor of tools.values()) send({ type: 'register', tool: stripDescriptor(descriptor) });
        for (const [name, state] of contexts) send({ type: 'context', name, state });
      }
      opened = true;
      flush();
    });
    next.addEventListener('error', () =>
      console.warn('[embinder] relay ws error — is the relay running on', url, '?'),
    );
    next.addEventListener('close', () => {
      if (ws !== next) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => void connect(), 100);
    });
    next.addEventListener('message', (e) => {
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
  };
  void connect();

  const modelContext: ModelContextSurface = {
    registerTool(descriptor, options) {
      tools.set(descriptor.name, descriptor);
      send({ type: 'register', tool: stripDescriptor(descriptor) });
      native?.registerTool(descriptor, options); // T-H1
      options?.signal?.addEventListener('abort', () => {
        tools.delete(descriptor.name);
        contexts.delete(descriptor.name);
        send({ type: 'unregister', name: descriptor.name });
      });
    },
  };

  return {
    modelContext,
    setPhaseListener(fn) {
      phaseListener = fn;
    },
    sendContext(name, state) {
      contexts.set(name, state);
      send({ type: 'context', name, state });
    },
    registerScope(scope) { scopes.set(scope.id, scope); send({ type: 'scope-register', scope }); },
    sendScopeContext(id, state) { scopeContexts.set(id, state); send({ type: 'scope-context', id, state }); },
    unregisterScope(id) { scopes.delete(id); scopeContexts.delete(id); send({ type: 'scope-unregister', id }); },
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

export interface EmbinderProviderProps {
  children: ReactNode;
  /** Relay ws endpoint. Default ws://127.0.0.1:7331/app */
  url?: string;
  /** Optional explicit ws token (otherwise fetched from the relay, T-G1). */
  token?: string;
  /** T-K: enable the agent-action spotlight + gate visualization (D7 polish, off by default). */
  viz?: boolean;
  /**
   * The resident agent bubble. Mounted by DEFAULT (D-9) — config comes from the relay's
   * /chat-config (env). Pass a config object to override, or `false` to opt out
   * (opt-out keeps the bubble code out of the bundle entirely).
   */
  chat?: import('./chat/ChatBubble.js').ChatBubbleConfig | false;
}

export function EmbinderProvider({ children, url = DEFAULT_URL, token, viz = false, chat }: EmbinderProviderProps) {
  ensureShim(url, token);

  // Register the built-in action tools (scroll/navigate/drag) through the relay shim.
  useEffect(() => {
    if (singleton) installActionTools(singleton.modelContext);
  }, []);

  // T-K: load the spotlight + ghost cursor only when the flag is on (zero driver.js /
  // mascot-image cost when off). Both consume the same relay phase events: the spotlight
  // highlights the target element, the ghost cursor (the AGENT's own pointer, separate from
  // the user's real cursor) glides to it.
  useEffect(() => {
    if (!viz || !singleton) return;
    let sp: Spotlight | undefined;
    let ghost: import('./ghost-cursor.js').GhostCursor | undefined;
    let cancelled = false;
    Promise.all([import('./spotlight.js'), import('./ghost-cursor.js')]).then(
      ([{ createSpotlight }, { createGhostCursor }]) => {
        if (cancelled) return;
        sp = createSpotlight(httpBaseFrom(url));
        ghost = createGhostCursor();
        singleton!.setPhaseListener((m) => {
          sp!.handle(m);
          ghost!.handle(m);
        });
      },
    );
    return () => {
      cancelled = true;
      singleton?.setPhaseListener(undefined);
      sp?.destroy();
      ghost?.destroy();
    };
  }, [viz, url]);

  // D-9: the resident bubble is the default — dynamic-imported unless explicitly opted out.
  const [Bubble, setBubble] = useState<null | ((c: Record<string, unknown>) => ReactElement)>(null);
  useEffect(() => {
    if (chat === false) return;
    let cancelled = false;
    import('./chat/ChatBubble.js').then(({ ChatBubble }) => {
      if (!cancelled) setBubble(() => ChatBubble as unknown as (c: Record<string, unknown>) => ReactElement);
    });
    return () => {
      cancelled = true;
    };
  }, [chat]);

  return (
    <>
      {children}
      {Bubble && chat !== false ? <Bubble {...((chat || {}) as object)} configBase={httpBaseFrom(url)} /> : null}
    </>
  );
}
