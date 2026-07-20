// @embinder/relay — MCP server + ws app-hub + policy gate (single port 127.0.0.1:7331).
// Backbone: T-C1 (dynamic tool registration), T-C2 (call bridge), T-C3 (streamable HTTP + stdio).
// Gate (Module D) is wired but destructive calls block until the approval surface lands (T-E1).
//
// Verified against @modelcontextprotocol/sdk v1.29.0:
//   McpServer                     server/mcp.ts:86
//   registerTool(name,config,cb)  server/mcp.ts:1052  (throws on dup :1065)
//   register >=1 tool BEFORE connect, else throws     server/index.ts:208
//   StreamableHTTPServerTransport server/streamableHttp.ts
//   isInitializeRequest           types.ts:537

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { z, type ZodRawShape } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { loadPolicy, riskOf } from './policy.js';
import { gate, type GateCtx } from './gate.js';
import { mintToken, tokenMatches, hostAllowed, originAllowed } from './security.js';
import { mountApprovalRoutes } from './approval-routes.js';
import { mountChatRoute, mountChatConfigRoute } from './chat.js';
import { enableCliApprovals, canonicalize, cancelByTool } from './approval.js';
import { CapabilityRegistry, type CapabilityDef } from './registry.js';

// A broken stdout pipe (parent process killed us mid-log) must not crash the relay.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const PORT = 7331;
const HOST = '127.0.0.1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// Load repo-root .env (LLM_BASE_URL / LLM_MODEL / OPENAI_API_KEY|LLM_KEY) if present.
// Existing process env wins; a missing file is fine.
try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  /* no .env — env must come from the shell */
}
const POLICY_PATH = process.env.EMBINDER_POLICY_PATH ?? resolve(ROOT, 'embinder.policy.json');
const AUDIT_PATH = process.env.EMBINDER_AUDIT_PATH ?? resolve(ROOT, 'audit.jsonl');
const policy = loadPolicy(POLICY_PATH);
const ENABLE_MCP = process.env.EMBINDER_ENABLE_MCP !== 'false';
const ENABLE_CHAT = process.env.EMBINDER_ENABLE_CHAT !== 'false';
const DIRECT_TOKEN = process.env.EMBINDER_DIRECT_TOKEN;

// ---- T-G1: one-time loopback tokens -----------------------------------------
const APP_TOKEN = mintToken(); // ws /app (browser app)
const APPROVER_TOKEN = mintToken(); // /api/decide (approval page)
// Written for local tooling/tests (gitignored). Browser fetches its token via GET /app-token.
try {
  mkdirSync(resolve(ROOT, '.embinder'), { recursive: true });
  writeFileSync(
    resolve(ROOT, '.embinder/session.json'),
    JSON.stringify({ port: PORT, appToken: APP_TOKEN, approverToken: APPROVER_TOKEN }, null, 2),
  );
} catch {
  /* non-fatal */
}

// ---- app socket (relay-owned) -----------------------------------------------
let appSocket: WebSocket | undefined;

// T-K2: display-only phase events relay→app (intent/gate/decided). Never on the MCP path.
function emitToApp(type: string, payload: Record<string, unknown>): void {
  if (appSocket?.readyState === WebSocket.OPEN) {
    appSocket.send(JSON.stringify({ type, ...payload }));
  }
}

// The lifecycle id is created once in the handler and reused for intent/gate/decided/call/result.
function forwardToBrowser(id: string, name: string, args: unknown): Promise<CallToolResult> {
  return new Promise((resolvePromise, reject) => {
    if (!appSocket || appSocket.readyState !== WebSocket.OPEN) {
      return reject(new Error('app not connected'));
    }
    registry.trackCall({
      id,
      name,
      args,
      resolve: (result) =>
        resolvePromise({ content: [{ type: 'text', text: JSON.stringify(result) }] }),
      reject,
    });
    appSocket.send(JSON.stringify({ type: 'call', id, name, args }));
  });
}

// ---- MCP sessions + central capability registry -----------------------------
// An McpServer binds to ONE transport at a time (protocol.ts:609). So we build a
// FRESH McpServer per MCP session and mirror the browser app's tools onto each.
// The registry is the source of truth; register/unregister fan out to live sessions,
// with unregister deferred by the D-6 grace window (quick remounts survive).

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  tools: Map<string, ReturnType<McpServer['registerTool']>>;
}
const sessions = new Map<string, Session>();

// Context-only pointers (no handler) contribute state to the chat system block but are
// never exposed as callable tools (D-5: fewer tools is the thesis).
export function isContextOnly(def: CapabilityDef): boolean {
  return Boolean(def.config.annotations?.embinderContextOnly);
}

const registry = new CapabilityRegistry({
  onAdd: () => {
    for (const [id, s] of sessions) syncSessionTools(id, s);
  },
  onRemove: (name) => {
    cancelByTool(name); // pending approvals for an off-screen capability are moot
    for (const [id, s] of sessions) syncSessionTools(id, s);
    console.log(`[embinder] capability left the screen: ${name}`);
  },
  // A remount within the grace window re-delivers calls the old mount never answered.
  onResend: (id, name, args) => {
    if (appSocket?.readyState === WebSocket.OPEN) {
      appSocket.send(JSON.stringify({ type: 'call', id, name, args }));
    }
  },
});

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
  const scope = registry.reserveScopedAction(session ?? '', name);
  if (!scope.ok) return { isError: true, content: [{ type: 'text', text: scope.error! }] };
  const id = randomUUID(); // one id for the whole lifecycle (T-K2)
  const risk = riskOf(policy, name, destructive);
  const canonicalPreview = canonicalize(args);

  // Every real action gets a visible preflight focus. This is display-only: the
  // gate and browser call begin immediately after it, while UI animation lingers.
  emitToApp('focus', { name, argsPreview: canonicalPreview });
  // T-K: tell the app what's about to happen (display only — app executes nothing until `call`).
  emitToApp('intent', { id, name, argsPreview: canonicalPreview });
  emitToApp('gate', { id, status: risk === 'destructive' ? 'awaiting' : 'auto' });

  const ctx: GateCtx = {
    session,
    auditPath: AUDIT_PATH,
    rateLimitPerMin: policy.rateLimit?.perToolPerMin,
    keepAlive,
    id, // key the pending approval by the lifecycle id so inline Approve/Deny resolves this call
  };

  try {
    const canonicalArgs = await gate(name, args, risk, signal, ctx);
    if (risk === 'destructive') emitToApp('decided', { id, decision: 'approved' });
    return await forwardToBrowser(id, name, canonicalArgs);
  } catch (err) {
    if (risk === 'destructive') emitToApp('decided', { id, decision: 'denied' });
    throw err;
  } finally {
    if (scope.scoped) {
      const sessionId = session ?? '';
      registry.settleScopedAction(sessionId);
      const target = sessions.get(sessionId);
      if (target) syncSessionTools(sessionId, target);
    }
  }
}

function registerGatedTool(
  server: McpServer,
  tools: Session['tools'],
  name: string,
  def: CapabilityDef,
) {
  if (tools.has(name)) tools.get(name)!.remove();
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
            params: { level: 'debug', logger: 'embinder', data: `awaiting approval for ${name}` },
          })
          .catch(() => {}),
    );
  });
  tools.set(name, tool);
}

function syncSessionTools(sessionId: string, session: Session) {
  const selected = new Map(registry.selectedEntries(sessionId).filter(([, def]) => !isContextOnly(def)));
  for (const [name, tool] of session.tools) if (!selected.has(name)) { tool.remove(); session.tools.delete(name); }
  for (const [name, def] of selected) {
    if (name.startsWith('focus_')) {
      if (session.tools.has(name)) continue;
      session.tools.set(name, session.server.registerTool(name, def.config, async (_args, extra) => {
        const result = registry.focus(extra.sessionId ?? sessionId, name);
        if (!result.ok) return { isError: true, content: [{ type: 'text', text: result.error }] };
        syncSessionTools(extra.sessionId ?? sessionId, session);
        emitToApp('focus', { name, scopeId: name.slice(6).replaceAll('__', '/') });
        return { content: [{ type: 'text', text: JSON.stringify(result.state) }] };
      }));
    } else if (!session.tools.has(name)) registerGatedTool(session.server, session.tools, name, def);
  }
}

// Build a new server pre-loaded with __gmc_ready + all currently-registered tools.
function buildSessionServer(): { server: McpServer; tools: Session['tools'] } {
  const server = new McpServer({ name: 'embinder-relay', version: '0.1.0' });
  const tools: Session['tools'] = new Map();
  // Prime one tool BEFORE connect (capabilities-after-connect gotcha, index.ts:208),
  // then disable it so it never shows in tools/list — it's an internal primer, not an
  // agent-facing tool (weak models otherwise pick it by mistake). Capability stays declared.
  const primer = server.registerTool('__gmc_ready', { description: 'internal' }, async () => ({
    content: [{ type: 'text', text: 'ready' }],
  }));
  primer.disable();
  // Session-specific tools sync after transport assigns its session id.
  return { server, tools };
}

// Minimal JSON Schema -> Zod raw shape (T-C1). TODO: broaden type coverage.
function toZodShape(schema: unknown): ZodRawShape {
  const s = schema as { properties?: Record<string, { type?: string }>; required?: string[] } | undefined;
  if (!s?.properties) return {};
  const shape: ZodRawShape = {};
  for (const [key, prop] of Object.entries(s.properties)) {
    let zt: z.ZodTypeAny =
      prop.type === 'number' || prop.type === 'integer' ? z.number()
      : prop.type === 'boolean' ? z.boolean()
      : prop.type === 'array' ? z.array(z.unknown())
      : prop.type === 'object' ? z.record(z.unknown())
      : z.string();
    if (!s.required?.includes(key)) zt = zt.optional();
    shape[key] = zt;
  }
  return shape;
}

// ---- Express + ws hub (one http server) -------------------------------------
const app = express();
app.use(express.json());

// T-G2: Host/Origin allowlist (blunts DNS-rebinding). Loopback-only; absent Origin = trusted.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!hostAllowed(req.headers.host)) return res.status(403).send('host not allowed');
  if (!originAllowed(req.headers.origin)) return res.status(403).send('origin not allowed');
  next();
});

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

// T-G1: the browser app fetches its ws token here (Origin-gated to :5173 by the middleware above).
app.get('/app-token', (req: Request, res: Response) => {
  res.json({ token: APP_TOKEN });
});

// On-screen approval is the only path: hand the app tab the approver-token so the spotlight can
// render inline Approve/Deny buttons. (The out-of-tab /approve page and its anti-self-approve
// posture were removed by product decision — the agent-driven tab now holds the token.)
app.get('/approver-token', (_req: Request, res: Response) => {
  res.json({ token: APPROVER_TOKEN });
});

// T-E1/E2: approval surface — /api/pending (SSE) + /api/decide.
mountApprovalRoutes(app, APPROVER_TOKEN);
// T-CB3: relay-hosted chat loop (Arch A). Reuses the registry + runGatedCall (one gate).
if (ENABLE_CHAT) {
  mountChatRoute(app, { registry, runGatedCall, onFocus: (phase) => emitToApp('focus', phase) });
  mountChatConfigRoute(app, { baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL });
}
enableCliApprovals();

app.post('/internal/direct-call', async (req: Request, res: Response, next: NextFunction) => {
  if (!DIRECT_TOKEN || !tokenMatches(req.header('x-embinder-direct-token'), DIRECT_TOKEN)) {
    return res.sendStatus(401);
  }
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  const def = registry.get(name);
  if (!def) return res.status(404).json({ error: 'capability_not_registered' });
  try {
    const result = await runGatedCall(
      name,
      req.body?.args ?? {},
      def.destructive,
      typeof req.body?.session === 'string' ? req.body.session : 'minder-direct',
      new AbortController().signal,
    );
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`[embinder] relay on http://${HOST}:${PORT}/mcp  (ws app: ws://${HOST}:${PORT}/app)`);
  console.log(`[embinder] approvals: on screen (inline Approve/Deny in the app tab)`);
  console.log(`[embinder] audit log: ${AUDIT_PATH}`);
});

const wss = new WebSocketServer({ server: httpServer, path: '/app' });
wss.on('connection', (ws, req) => {
  // T-G1/G2: only the app holding the minted token, from an allowed origin, may attach.
  const url = new URL(req.url ?? '/app', 'http://localhost');
  const token = url.searchParams.get('token') ?? undefined;
  if (!originAllowed(req.headers.origin) || !tokenMatches(token, APP_TOKEN)) {
    console.warn('[embinder] app ws rejected (bad origin or token)');
    ws.close(1008, 'unauthorized');
    return;
  }
  appSocket = ws;
  console.log('[embinder] app connected');
  ws.on('message', (buf) => {
    const m = JSON.parse(String(buf));
    switch (m.type) {
      case 'register': {
        const def: CapabilityDef = {
          config: {
            description: m.tool.description,
            inputSchema: toZodShape(m.tool.inputSchema),
            annotations: m.tool.annotations,
          },
          destructive: Boolean(m.tool.annotations?.destructiveHint),
          scopeId: typeof m.tool.annotations?.embinderScope === 'string' ? m.tool.annotations.embinderScope : undefined,
        };
        registry.register(m.tool.name, def);
        console.log(`[embinder] capability registered: ${m.tool.name}`);
        break;
      }
      case 'scope-register': registry.registerScope(m.scope); for (const [id, s] of sessions) syncSessionTools(id, s); break;
      case 'scope-context': registry.setScopeContext(m.id, m.state); break;
      case 'scope-unregister': registry.unregisterScope(m.id); for (const [id, s] of sessions) syncSessionTools(id, s); break;
      case 'unregister':
        registry.unregister(m.name); // D-6: session removal happens on grace expiry
        break;
      case 'context':
        registry.setContext(m.name, m.state); // app-socket only: we're inside the authed ws
        break;
      case 'result':
        registry.settle(m.id, m.error ? { error: m.error } : m.result);
        break;
    }
  });
  ws.on('close', () => {
    if (appSocket === ws) appSocket = undefined;
    console.log('[embinder] app disconnected');
  });
  // A dying browser tab must never crash the relay (EPIPE on a half-closed socket).
  ws.on('error', (err) => {
    if (appSocket === ws) appSocket = undefined;
    console.warn(`[embinder] app socket error: ${err.message}`);
  });
});

// ---- MCP streamable HTTP routes (optional; disabled for Minder integration) --
if (ENABLE_MCP) {
app.post('/mcp', async (req: Request, res: Response) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  let transport = sid ? sessions.get(sid)?.transport : undefined;

  if (!transport && isInitializeRequest(req.body)) {
    // Fresh McpServer per session (one server ⇄ one transport, protocol.ts:609).
    const { server, tools } = buildSessionServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport: transport!, tools });
        syncSessionTools(id, sessions.get(id)!);
        console.log(`[embinder] mcp session ${id.slice(0, 8)} connected`);
      },
    });
    transport.onclose = () => {
      const s = transport!.sessionId;
      if (s) {
        sessions.delete(s);
        console.log(`[embinder] mcp session ${s.slice(0, 8)} closed`);
      }
    };
    await server.connect(transport);
  }

  if (!transport) {
    return res
      .status(400)
      .json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'No valid session' } });
  }
  await transport.handleRequest(req, res, req.body);
});

const sessionRoute = (req: Request, res: Response) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  const transport = sid ? sessions.get(sid)?.transport : undefined;
  if (!transport) return res.status(400).send('No valid session');
  return transport.handleRequest(req, res);
};
app.get('/mcp', sessionRoute);
app.delete('/mcp', sessionRoute);
}

// ---- stdio fallback (T-C3) --------------------------------------------------
if (ENABLE_MCP && process.argv.includes('--stdio')) {
  const { server: stdioServer } = buildSessionServer();
  stdioServer.connect(new StdioServerTransport());
  console.log('[embinder] stdio transport connected');
}
