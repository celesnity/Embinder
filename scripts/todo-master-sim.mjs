#!/usr/bin/env node
// Master Agent simulator — plays the Master Agent role from agent-blackboard's
// docs/MASTER_AGENT_GUIDE.md, but talks to the blackboard purely over MCP (Streamable HTTP,
// JSON-RPC 2.0), the same wire protocol proven in agent-blackboard's e2e/mcp-client/client.py
// (run_master()). No REST fallback, no SDK — this exercises the real MCP connector
// (apps/blackboard-server/src/mcp.rs) that a genuine Master Agent would use.
//
// It creates one `todo-operate` Task and polls it (with backoff, per the guide's
// anti-pattern warning against busy-polling) until the already-running todo-worker
// (scripts/todo-worker.mjs) claims and completes it.
//
// Usage:
//   node scripts/todo-master-sim.mjs --blackboard-id <id>
//   node scripts/todo-master-sim.mjs --blackboard-id <id> --subject "Create a low-priority task named Foo" --input '{"note":"demo"}'
//
// The target blackboard is never guessed — pass --blackboard-id or set BLACKBOARD_ID
// explicitly (get one with: curl "$BLACKBOARD_URL/api/v1/blackboards?project_id=<id>"
// -H "x-api-key: $BLACKBOARD_API_KEY"). This repo's local dev board is
// 3ac5017f-a026-4701-8ebd-a4123728d2c6 (`embinder-todo-operator` / `todo-operator`), the one
// scripts/todo-worker.mjs is registered and polling against — but nothing here defaults to it
// silently, so you always know which board a Task landed on.
//
// Env:
//   BLACKBOARD_URL      default http://127.0.0.1:8080
//   BLACKBOARD_API_KEY  default dev-key (the local docker-compose DEV_API_KEY)
//   BLACKBOARD_ID       alternative to --blackboard-id

const REST_URL = process.env.BLACKBOARD_URL ?? 'http://127.0.0.1:8080';
const API_KEY = process.env.BLACKBOARD_API_KEY ?? 'dev-key';
const CAPABILITY = process.env.BLACKBOARD_CAPABILITY ?? 'todo-operate';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

function log(event, fields) {
  console.log(`[master-sim] ${event}`, fields ?? '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decode a Streamable HTTP response body: either plain JSON, or an SSE stream carrying one
 * or more `data:` frames (rmcp sends a blank keep-alive frame before the real one) — the
 * JSON-RPC envelope is the last non-empty `data:` line.
 */
function decodeJsonRpc(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    const frames = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice('data:'.length).trim())
      .filter(Boolean);
    const last = frames.at(-1);
    if (!last) throw new Error(`MCP response is neither JSON nor SSE data: ${text}`);
    message = JSON.parse(last);
  }
  if (message.error) throw new Error(`MCP error: ${JSON.stringify(message.error)}`);
  if (!message.result) throw new Error(`MCP response has no result: ${text}`);
  return message.result;
}

/** Tool results carry either structuredContent or a JSON-encoded text content part. */
function extractToolOutput(result) {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  const textPart = (result.content ?? []).find((part) => part?.type === 'text');
  if (!textPart) throw new Error(`MCP tool result has no usable content: ${JSON.stringify(result)}`);
  return JSON.parse(textPart.text);
}

/** Minimal MCP (Streamable HTTP) client: initialize once, then tools/call per Task. */
class McpSession {
  #url;
  #apiKey;
  #sessionId;
  #nextId = 1;

  constructor(url, apiKey) {
    this.#url = url;
    this.#apiKey = apiKey;
  }

  async #post(request) {
    const response = await fetch(this.#url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.#sessionId ? { 'mcp-session-id': this.#sessionId } : {}),
      },
      body: JSON.stringify(request),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${body}`);
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.#sessionId = sessionId;
    return decodeJsonRpc(body);
  }

  async initialize() {
    await this.#post({
      jsonrpc: '2.0',
      id: this.#nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'minder-master-sim', version: '1.0' },
      },
    });
  }

  async call(name, args) {
    const result = await this.#post({
      jsonrpc: '2.0',
      id: this.#nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    return extractToolOutput(result);
  }
}

async function main() {
  const blackboardId = arg('blackboard-id', process.env.BLACKBOARD_ID);
  if (!blackboardId) {
    throw new Error(
      'no target blackboard given — pass --blackboard-id <id> or set BLACKBOARD_ID ' +
        '(this repo\'s local dev board is 3ac5017f-a026-4701-8ebd-a4123728d2c6, `todo-operator`)',
    );
  }
  const subject = arg(
    'subject',
    'Create a high-priority Todo task named "Ship the MCP master-agent demo" and tag it demo.',
  );
  const inputRaw = arg('input', '{"source":"master-sim"}');
  const timeoutSeconds = Number(arg('timeout', '90'));
  let input;
  try {
    input = JSON.parse(inputRaw);
  } catch {
    throw new Error(`--input must be valid JSON, got: ${inputRaw}`);
  }

  const mcpUrl = new URL('/mcp', REST_URL).toString();
  const mcp = new McpSession(mcpUrl, API_KEY);
  await mcp.initialize();
  log('mcp_session_ready', { url: mcpUrl });

  const created = await mcp.call('create_task', {
    blackboard_id: blackboardId,
    capability: CAPABILITY,
    subject,
    input,
  });
  log('task_created', { task_id: created.id, blackboard_id: blackboardId, subject });

  const deadline = Date.now() + timeoutSeconds * 1000;
  let backoffMs = 1000;
  let task = created;
  while (Date.now() < deadline && task.status !== 'completed' && task.status !== 'failed') {
    await sleep(backoffMs);
    task = await mcp.call('get_task', { id: created.id });
    log('polling', { status: task.status });
    backoffMs = Math.min(backoffMs * 1.5, 5000);
  }

  if (task.status !== 'completed' && task.status !== 'failed') {
    throw new Error(`timed out after ${timeoutSeconds}s — task ${created.id} still "${task.status}"`);
  }

  if (task.status === 'completed') {
    log('task_completed', task.result);
  } else {
    log('task_failed', { failure_reason: task.failure_reason });
  }

  const artifacts = await mcp.call('query_artifacts', {
    blackboard_id: blackboardId,
    correlation_id: created.id,
  });
  const trail = [...new Set((artifacts.artifacts ?? []).map((a) => a.type))];
  log('artifact_trail', trail);
}

main().catch((error) => {
  console.error('[master-sim] failed:', error?.message ?? error);
  process.exitCode = 1;
});
