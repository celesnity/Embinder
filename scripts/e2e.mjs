// One-command E2E: proves the full pipeline through the relay + the policy gate.
//   npm run e2e
// Spawns the relay, plays a fake browser app (ws /app) + a real MCP client (/mcp), and drives
// the approval surface headlessly. Covers AC-1..AC-6 + the LM Studio multi-session regression.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Minimal OpenAI-compatible /v1/chat/completions stub (streaming). Turn 1: emit a tool call.
// Turn 2 (messages contain a tool role): emit a final text chunk. Enough to exercise the gate.
function startStubLLM(toolName, toolArgs) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const hasToolResult = (payload.messages ?? []).some((m) => m.role === 'tool');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const id = 'chatcmpl-stub';
      const created = 1700000000; // fixed; stub is deterministic
      if (!hasToolResult) {
        // stream one tool call
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: toolName, arguments: '' } }] }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(toolArgs) } }] }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

// Drive POST /chat and drain the UI-message SSE stream to completion.
async function runChat(baseURL, model, text) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      baseURL,
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text }] }],
    }),
  });
  if (res.status !== 200) return { status: res.status };
  const reader = res.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
  return { status: 200 };
}

const BASE = 'http://127.0.0.1:7331';
const MCP = `${BASE}/mcp`;

let failures = 0;
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

// fake browser app state
const board = [];
let nextId = 1;

// --- boot relay -------------------------------------------------------------
const relay = spawn('npx', ['tsx', 'packages/relay/src/server.ts'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  const t = globalThis.setTimeout(() => reject(new Error('relay did not start in 10s')), 10_000);
  relay.stdout.on('data', (d) => {
    if (String(d).includes('relay on')) { clearTimeout(t); resolve(); }
  });
});

const { appToken, approverToken } = JSON.parse(readFileSync('.grabmycursor/session.json', 'utf8'));

// Read the first pending approval from the SSE stream.
async function firstPending() {
  const res = await fetch(`${BASE}/api/pending`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop();
    for (const ev of chunks) {
      const line = ev.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const m = JSON.parse(line.slice(6));
      if (m.type === 'init' && m.pending.length) { await reader.cancel(); return m.pending[0]; }
      if (m.type === 'add') { await reader.cancel(); return m.pending; }
    }
  }
  await reader.cancel();
  return null;
}

const decide = (id, approve, token = approverToken) =>
  fetch(`${BASE}/api/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-approver-token': token },
    body: JSON.stringify({ id, approve }),
  });

let ws, client, client2;
try {
  // --- fake browser app (token-authenticated ws) ---------------------------
  ws = new WebSocket(`ws://127.0.0.1:7331/app?token=${encodeURIComponent(appToken)}`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('error', () => {});
  ws.on('message', (buf) => {
    const m = JSON.parse(String(buf));
    if (m.type !== 'call') return;
    let result;
    if (m.name === 'list_tasks') result = { tasks: board };
    else if (m.name === 'add_task') { const t = { id: `t${nextId++}`, text: m.args.text }; board.push(t); result = { ok: true, added: t }; }
    else if (m.name === 'delete_all_tasks') { const n = board.length; board.length = 0; result = { ok: true, cleared: n }; }
    else if (m.name === 'delete_task') { const i = board.findIndex((t) => t.id === m.args.id); if (i >= 0) board.splice(i, 1); result = { ok: true }; }
    else result = { ok: false };
    ws.send(JSON.stringify({ type: 'result', id: m.id, result }));
  });
  const reg = (name, schema, annotations) =>
    ws.send(JSON.stringify({ type: 'register', tool: { name, description: name, inputSchema: schema, annotations } }));
  reg('list_tasks', { type: 'object', properties: {} }, { readOnlyHint: true });
  reg('add_task', { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, {});
  reg('delete_task', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, { destructiveHint: true });
  reg('delete_all_tasks', { type: 'object', properties: {} }, { destructiveHint: true });
  await sleep(250);

  // --- session 1 ------------------------------------------------------------
  client = new Client({ name: 'e2e-probe', version: '0.0.1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP)));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert(tools.includes('add_task') && tools.includes('delete_all_tasks'), `tools/list ok (got: ${tools.join(', ')})`);
  assert(!tools.includes('__gmc_ready'), 'internal primer hidden from tools/list');

  // write passes the gate straight through
  const add = JSON.parse((await client.callTool({ name: 'add_task', arguments: { text: 'milk' } })).content[0].text);
  assert(add.ok === true, `add_task (write) passes gate (got: ${JSON.stringify(add)})`);
  assert(board.some((t) => t.text === 'milk'), 'task "milk" landed in the app board');

  // read passes the gate straight through
  const listed = JSON.parse((await client.callTool({ name: 'list_tasks', arguments: {} })).content[0].text);
  assert(Array.isArray(listed.tasks) && listed.tasks.length >= 1, 'list_tasks (read) passes gate');

  // --- 2nd concurrent session (regresses "Already connected") ---------------
  client2 = new Client({ name: 'e2e-probe-2', version: '0.0.1' });
  await client2.connect(new StreamableHTTPClientTransport(new URL(MCP)));
  assert((await client2.listTools()).tools.length > 0, 'two concurrent MCP sessions coexist');

  // --- destructive -> pending -> APPROVE -> runs (AC-3) --------------------
  const clearP = client.callTool({ name: 'delete_all_tasks', arguments: {} });
  const pend = await firstPending();
  assert(pend && pend.tool === 'delete_all_tasks', 'destructive call paused at the gate (pending)');
  await decide(pend.id, true);
  const cleared = JSON.parse((await clearP).content[0].text);
  assert(cleared.ok === true, 'approved destructive call ran');
  assert(board.length === 0, 'board cleared after approval');

  // --- destructive -> pending -> DENY -> isError, no mutation (AC-3) -------
  board.push({ id: 'tX', text: 'keep me' });
  const denyP = client.callTool({ name: 'delete_all_tasks', arguments: {} });
  const pend2 = await firstPending();
  await decide(pend2.id, false);
  const denied = await denyP;
  assert(denied.isError === true, 'denied destructive call returns isError to agent');
  assert(board.length === 1, 'board unchanged after deny');

  // --- anti self-approve: wrong token -> 403 (AC-4) ------------------------
  const badP = client.callTool({ name: 'delete_all_tasks', arguments: {} });
  const pend3 = await firstPending();
  const bad = await decide(pend3.id, true, 'WRONG-TOKEN');
  assert(bad.status === 403, `decide with wrong approver-token -> 403 (got ${bad.status})`);
  await decide(pend3.id, false); // clean up the pending

  // --- fidelity: hidden unicode flagged, canonical executes (AC-5) ---------
  const tamperP = client.callTool({ name: 'delete_task', arguments: { id: 't1​​' } });
  const pend4 = await firstPending();
  assert(pend4 && pend4.tampered === true, 'tampered args flagged (raw ≠ canonical)');
  assert(pend4.canonical.id === 't1', `canonical strips hidden unicode (got: ${JSON.stringify(pend4.canonical)})`);
  await decide(pend4.id, false);
  await tamperP.catch(() => {});

  // --- audit (AC-6) ---------------------------------------------------------
  const audit = readFileSync('audit.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert(audit.some((e) => e.decision === 'pending'), 'audit.jsonl records intent (pending)');
  assert(audit.some((e) => e.decision === 'allow' && e.approver === 'ui'), 'audit.jsonl records approved outcome');
  assert(audit.some((e) => e.decision === 'deny'), 'audit.jsonl records denied outcome');

  // --- T-CB3: bubble path drives a WRITE tool through the SAME gate ----------
  const stub = await startStubLLM('add_task', { text: 'from-bubble' });
  const stubURL = `http://127.0.0.1:${stub.port}/v1`;
  const chatWrite = await runChat(stubURL, 'stub-model', 'add a task');
  assert(chatWrite.status === 200, `/chat streamed ok (got ${chatWrite.status})`);
  assert(board.some((t) => t.text === 'from-bubble'), 'chat tool call landed on the board via the gate');

  // --- T-CB3: destructive from the bubble PAUSES at the gate, then approves --
  const stub2 = await startStubLLM('delete_all_tasks', {});
  const stub2URL = `http://127.0.0.1:${stub2.port}/v1`;
  const chatDestructiveP = runChat(stub2URL, 'stub-model', 'clear everything');
  const chatPend = await firstPending();
  assert(chatPend && chatPend.tool === 'delete_all_tasks', 'chat destructive call paused at the gate');
  await decide(chatPend.id, true);
  await chatDestructiveP;
  assert(board.length === 0, 'chat destructive call ran after approval');

  // --- T-CB3: baseURL outside the allowlist is rejected (SSRF guard) ---------
  const badBase = await runChat('http://evil.example.com/v1', 'stub-model', 'hi');
  assert(badBase.status === 400, `off-allowlist baseURL -> 400 (got ${badBase.status})`);

  stub.server.close();
  stub2.server.close();
} finally {
  await client?.close().catch(() => {});
  await client2?.close().catch(() => {});
  ws?.close();
  relay.kill();
}

console.log(failures === 0 ? '\n✅ E2E + GATE GREEN' : `\n❌ ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
