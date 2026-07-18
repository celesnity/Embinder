// @minder/relay — MCP server + ws app-hub + policy gate (single port 127.0.0.1:7331).
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
import express, { type Request, type Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { z, type ZodRawShape } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { loadPolicy, riskOf } from './policy.js';
import { gate } from './gate.js';

const PORT = 7331;
const HOST = '127.0.0.1';
const POLICY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../minder.policy.json');
const policy = loadPolicy(POLICY_PATH);

// ---- app socket (relay-owned) + pending calls -------------------------------
let appSocket: WebSocket | undefined;
const pending = new Map<string, (result: unknown) => void>();

function forwardToBrowser(name: string, args: unknown): Promise<CallToolResult> {
  return new Promise((resolvePromise, reject) => {
    if (!appSocket || appSocket.readyState !== WebSocket.OPEN) {
      return reject(new Error('app not connected'));
    }
    const id = randomUUID();
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

function registerGatedTool(
  server: McpServer,
  tools: Session['tools'],
  name: string,
  def: ToolDef,
) {
  if (tools.has(name)) tools.get(name)!.remove();
  const tool = server.registerTool(name, def.config, async (args: unknown, extra) => {
    const risk = riskOf(policy, name, def.destructive);
    await gate(name, args, risk, extra.signal); // pauses/denies destructive; passes read/write
    return forwardToBrowser(name, args);
  });
  tools.set(name, tool);
}

// Build a new server pre-loaded with __minder_ready + all currently-registered tools.
function buildSessionServer(): { server: McpServer; tools: Session['tools'] } {
  const server = new McpServer({ name: 'minder-relay', version: '0.1.0' });
  const tools: Session['tools'] = new Map();
  // Prime one tool BEFORE connect (capabilities-after-connect gotcha, index.ts:208),
  // then disable it so it never shows in tools/list — it's an internal primer, not an
  // agent-facing tool (weak models otherwise pick it by mistake). Capability stays declared.
  const primer = server.registerTool('__minder_ready', { description: 'internal' }, async () => ({
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

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`[minder] relay on http://${HOST}:${PORT}/mcp  (ws app: ws://${HOST}:${PORT}/app)`);
});

const wss = new WebSocketServer({ server: httpServer, path: '/app' });
wss.on('connection', (ws) => {
  appSocket = ws;
  console.log('[minder] app connected');
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
        console.log(`[minder] tool registered: ${m.tool.name}`);
        break;
      }
      case 'unregister':
        toolRegistry.delete(m.name);
        for (const s of sessions.values()) {
          s.tools.get(m.name)?.remove();
          s.tools.delete(m.name);
        }
        console.log(`[minder] tool unregistered: ${m.name}`);
        break;
      case 'result':
        pending.get(m.id)?.(m.error ? { error: m.error } : m.result);
        pending.delete(m.id);
        break;
    }
  });
  ws.on('close', () => {
    if (appSocket === ws) appSocket = undefined;
    console.log('[minder] app disconnected');
  });
  // A dying browser tab must never crash the relay (EPIPE on a half-closed socket).
  ws.on('error', (err) => {
    if (appSocket === ws) appSocket = undefined;
    console.warn(`[minder] app socket error: ${err.message}`);
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
        console.log(`[minder] mcp session ${id.slice(0, 8)} connected`);
      },
    });
    transport.onclose = () => {
      const s = transport!.sessionId;
      if (s) {
        sessions.delete(s);
        console.log(`[minder] mcp session ${s.slice(0, 8)} closed`);
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
  console.log('[minder] stdio transport connected');
}
