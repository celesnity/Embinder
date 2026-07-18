// @grabmycursor/relay — MCP server + ws app-hub + policy gate (single port 127.0.0.1:7331).
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
import { enableCliApprovals, canonicalize } from './approval.js';

// A broken stdout pipe (parent process killed us mid-log) must not crash the relay.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const PORT = 7331;
const HOST = '127.0.0.1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const POLICY_PATH = resolve(ROOT, 'grabmycursor.policy.json');
const AUDIT_PATH = resolve(ROOT, 'audit.jsonl');
const policy = loadPolicy(POLICY_PATH);

// ---- T-G1: one-time loopback tokens -----------------------------------------
const APP_TOKEN = mintToken(); // ws /app (browser app)
const APPROVER_TOKEN = mintToken(); // /api/decide (approval page)
// Written for local tooling/tests (gitignored). Browser fetches its token via GET /app-token.
try {
  mkdirSync(resolve(ROOT, '.grabmycursor'), { recursive: true });
  writeFileSync(
    resolve(ROOT, '.grabmycursor/session.json'),
    JSON.stringify({ port: PORT, appToken: APP_TOKEN, approverToken: APPROVER_TOKEN }, null, 2),
  );
} catch {
  /* non-fatal */
}

// ---- app socket (relay-owned) + pending calls -------------------------------
let appSocket: WebSocket | undefined;
const pending = new Map<string, (result: unknown) => void>();

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
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`tool "${name}" timed out`));
    }, 30_000);
    pending.set(id, (result) => {
      clearTimeout(timer);
      resolvePromise({ content: [{ type: 'text', text: JSON.stringify(result) }] });
    });
    appSocket.send(JSON.stringify({ type: 'call', id, name, args }));
  });
}

// ---- MCP sessions + central tool registry -----------------------------------
// An McpServer binds to ONE transport at a time (protocol.ts:609). So we build a
// FRESH McpServer per MCP session and mirror the browser app's tools onto each.
// The registry is the source of truth; register/unregister fan out to live sessions.

interface ToolDef {
  config: { description?: string; inputSchema?: ZodRawShape; annotations?: Record<string, unknown> };
  destructive: boolean;
}
const toolRegistry = new Map<string, ToolDef>();

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  tools: Map<string, ReturnType<McpServer['registerTool']>>;
}
const sessions = new Map<string, Session>();

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

function registerGatedTool(
  server: McpServer,
  tools: Session['tools'],
  name: string,
  def: ToolDef,
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
            params: { level: 'debug', logger: 'grabmycursor', data: `awaiting approval for ${name}` },
          })
          .catch(() => {}),
    );
  });
  tools.set(name, tool);
}

// Build a new server pre-loaded with __gmc_ready + all currently-registered tools.
function buildSessionServer(): { server: McpServer; tools: Session['tools'] } {
  const server = new McpServer({ name: 'grabmycursor-relay', version: '0.1.0' });
  const tools: Session['tools'] = new Map();
  // Prime one tool BEFORE connect (capabilities-after-connect gotcha, index.ts:208),
  // then disable it so it never shows in tools/list — it's an internal primer, not an
  // agent-facing tool (weak models otherwise pick it by mistake). Capability stays declared.
  const primer = server.registerTool('__gmc_ready', { description: 'internal' }, async () => ({
    content: [{ type: 'text', text: 'ready' }],
  }));
  primer.disable();
  for (const [name, def] of toolRegistry) registerGatedTool(server, tools, name, def);
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

// T-G1: the browser app fetches its ws token here (Origin-gated to :5173 by the middleware above).
app.get('/app-token', (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (origin) res.set('Access-Control-Allow-Origin', origin); // already allowlisted by middleware
  res.json({ token: APP_TOKEN });
});

// T-E1/E2: approval surface (out-of-tab).
mountApprovalRoutes(app, APPROVER_TOKEN);
enableCliApprovals();

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`[grabmycursor] relay on http://${HOST}:${PORT}/mcp  (ws app: ws://${HOST}:${PORT}/app)`);
  console.log(`[grabmycursor] approvals: http://127.0.0.1:${PORT}/approve`);
  console.log(`[grabmycursor] audit log: ${AUDIT_PATH}`);
});

const wss = new WebSocketServer({ server: httpServer, path: '/app' });
wss.on('connection', (ws, req) => {
  // T-G1/G2: only the app holding the minted token, from an allowed origin, may attach.
  const url = new URL(req.url ?? '/app', 'http://localhost');
  const token = url.searchParams.get('token') ?? undefined;
  if (!originAllowed(req.headers.origin) || !tokenMatches(token, APP_TOKEN)) {
    console.warn('[grabmycursor] app ws rejected (bad origin or token)');
    ws.close(1008, 'unauthorized');
    return;
  }
  appSocket = ws;
  console.log('[grabmycursor] app connected');
  ws.on('message', (buf) => {
    const m = JSON.parse(String(buf));
    switch (m.type) {
      case 'register': {
        const def: ToolDef = {
          config: {
            description: m.tool.description,
            inputSchema: toZodShape(m.tool.inputSchema),
            annotations: m.tool.annotations,
          },
          destructive: Boolean(m.tool.annotations?.destructiveHint),
        };
        toolRegistry.set(m.tool.name, def);
        for (const s of sessions.values()) registerGatedTool(s.server, s.tools, m.tool.name, def);
        console.log(`[grabmycursor] tool registered: ${m.tool.name}`);
        break;
      }
      case 'unregister':
        toolRegistry.delete(m.name);
        for (const s of sessions.values()) {
          s.tools.get(m.name)?.remove();
          s.tools.delete(m.name);
        }
        console.log(`[grabmycursor] tool unregistered: ${m.name}`);
        break;
      case 'result':
        pending.get(m.id)?.(m.error ? { error: m.error } : m.result);
        pending.delete(m.id);
        break;
    }
  });
  ws.on('close', () => {
    if (appSocket === ws) appSocket = undefined;
    console.log('[grabmycursor] app disconnected');
  });
  // A dying browser tab must never crash the relay (EPIPE on a half-closed socket).
  ws.on('error', (err) => {
    if (appSocket === ws) appSocket = undefined;
    console.warn(`[grabmycursor] app socket error: ${err.message}`);
  });
});

// ---- MCP streamable HTTP routes (T-C3) --------------------------------------
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
        console.log(`[grabmycursor] mcp session ${id.slice(0, 8)} connected`);
      },
    });
    transport.onclose = () => {
      const s = transport!.sessionId;
      if (s) {
        sessions.delete(s);
        console.log(`[grabmycursor] mcp session ${s.slice(0, 8)} closed`);
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

// ---- stdio fallback (T-C3) --------------------------------------------------
if (process.argv.includes('--stdio')) {
  const { server: stdioServer } = buildSessionServer();
  stdioServer.connect(new StdioServerTransport());
  console.log('[grabmycursor] stdio transport connected');
}
