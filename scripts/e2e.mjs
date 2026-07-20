// One-command E2E: proves the full pipeline through the relay + the policy gate.
//   npm run e2e
// Spawns the relay, plays a fake browser app (ws /app) simulating the TWO-PAGE demo
// (Board ⇄ Archive), plus a real MCP client (/mcp) and the bubble path (/chat with a
// stub LLM). Assertions are tagged with the embinder-pointer success criteria (SC-n).

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const GRACE_MS = 2000; // must match registry default (D-6)

// Minimal OpenAI-compatible /v1/chat/completions stub (streaming). Turn 1: emit a tool call.
// Turn 2 (messages contain a tool role): emit a final text chunk. Captures every request
// payload so tests can assert what the model was shown (system block, tool set).
function startStubLLM(toolName, toolArgs) {
  const payloads = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body || '{}');
      payloads.push(payload);
      const hasToolResult = (payload.messages ?? []).some((m) => m.role === 'tool');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const id = 'chatcmpl-stub';
      const created = 1700000000; // fixed; stub is deterministic
      if (!hasToolResult && toolName) {
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
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, payloads })),
  );
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

// fake browser app state (shared store, like the real two-page demo)
const board = [];
let nextId = 1;
let muteRestore = false; // when true, restore_task calls go unanswered (unmount-mid-call tests)

// --- boot relay -------------------------------------------------------------
const relay = spawn(process.execPath, ['--import', 'tsx', 'packages/relay/src/server.ts'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: {
    ...process.env,
    LLM_BASE_URL: 'http://127.0.0.1:4242/v1',
    LLM_MODEL: 'demo-model',
    GMC_INLINE_APPROVAL: '0',
  },
});
await new Promise((resolve, reject) => {
  const t = globalThis.setTimeout(() => reject(new Error('relay did not start in 10s')), 10_000);
  relay.stdout.on('data', (d) => {
    if (String(d).includes('relay on')) { clearTimeout(t); resolve(); }
  });
});

const { appToken, approverToken } = JSON.parse(readFileSync('.embinder/session.json', 'utf8'));

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

  const send = (o) => ws.send(JSON.stringify(o));
  const pushBoardContext = () => send({ type: 'context', name: 'task_board', state: { openTasks: board } });

  ws.on('message', (buf) => {
    const m = JSON.parse(String(buf));
    if (m.type !== 'call') return;
    let result;
    if (m.name === 'add_task') { const t = { id: `t${nextId++}`, text: m.args.text }; board.push(t); result = { ok: true, added: t }; }
    else if (m.name === 'delete_all_tasks') { const n = board.length; board.length = 0; result = { ok: true, cleared: n }; }
    else if (m.name === 'delete_task') { const i = board.findIndex((t) => t.id === m.args.id); if (i >= 0) board.splice(i, 1); result = { ok: true }; }
    else if (m.name === 'restore_task') { if (muteRestore) return; result = { ok: true, restored: m.args.id }; }
    else if (m.name === 'purge_archive') result = { ok: true, purged: 0 };
    else result = { ok: false };
    send({ type: 'result', id: m.id, result });
    pushBoardContext(); // the real hook pushes a fresh snapshot after each mutation
  });

  const reg = (name, schema, annotations) =>
    send({ type: 'register', tool: { name, description: name, inputSchema: schema, annotations } });
  const unreg = (name) => send({ type: 'unregister', name });

  // Board page (like BoardPage mounting): context-only pointer + callable capabilities.
  const BOARD_TOOLS = ['add_task', 'toggle_task', 'edit_task', 'delete_task', 'delete_all_tasks', 'bulk_delete'];
  function mountBoard() {
    reg('task_board', { type: 'object', properties: {} }, { embinderContextOnly: true });
    reg('add_task', { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, {});
    reg('toggle_task', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, {});
    reg('edit_task', { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] }, {});
    reg('delete_task', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, { destructiveHint: true });
    reg('delete_all_tasks', { type: 'object', properties: {} }, { destructiveHint: true });
    reg('bulk_delete', { type: 'object', properties: { ids: { type: 'array' } }, required: ['ids'] }, { destructiveHint: true });
    pushBoardContext();
  }
  const ARCHIVE_TOOLS = ['restore_task', 'purge_archive'];
  function mountArchive() {
    reg('archive_list', { type: 'object', properties: {} }, { embinderContextOnly: true });
    reg('restore_task', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, {});
    reg('purge_archive', { type: 'object', properties: {} }, { destructiveHint: true });
    send({ type: 'context', name: 'archive_list', state: { doneTasks: [{ id: 'a1', text: 'archived thing' }] } });
  }
  const unmountBoard = () => { unreg('task_board'); for (const t of BOARD_TOOLS) unreg(t); };
  const unmountArchive = () => { unreg('archive_list'); for (const t of ARCHIVE_TOOLS) unreg(t); };

  mountBoard();
  await sleep(250);

  // --- SC-1/SC-5: session 1 sees exactly the Board capabilities -------------
  client = new Client({ name: 'e2e-probe', version: '0.0.1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP)));
  let tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert(BOARD_TOOLS.every((t) => tools.includes(t)), `SC-2 tools/list has the Board set (got: ${tools.join(', ')})`);
  assert(!tools.includes('task_board'), 'SC-3 context-only pointer is NOT a callable tool');
  assert(!tools.some((t) => t.startsWith('list_')), 'SC-3 zero list_* read tools exist');
  assert(!tools.includes('__gmc_ready'), 'internal primer hidden from tools/list');

  // write passes the gate straight through
  const add = JSON.parse((await client.callTool({ name: 'add_task', arguments: { text: 'milk' } })).content[0].text);
  assert(add.ok === true, `SC-1 add_task (write) passes gate (got: ${JSON.stringify(add)})`);
  assert(board.some((t) => t.text === 'milk'), 'SC-1 task "milk" landed in the app board');

  // --- 2nd concurrent session (regresses "Already connected") ---------------
  client2 = new Client({ name: 'e2e-probe-2', version: '0.0.1' });
  await client2.connect(new StreamableHTTPClientTransport(new URL(MCP)));
  assert((await client2.listTools()).tools.length > 0, 'SC-5 two concurrent MCP sessions coexist');

  // --- destructive -> pending -> APPROVE -> runs (AC-3) --------------------
  const clearP = client.callTool({ name: 'delete_all_tasks', arguments: {} });
  const pend = await firstPending();
  assert(pend && pend.tool === 'delete_all_tasks', 'SC-6 destructive call paused at the gate (pending)');
  await decide(pend.id, true);
  const cleared = JSON.parse((await clearP).content[0].text);
  assert(cleared.ok === true, 'SC-6 approved destructive call ran');
  assert(board.length === 0, 'board cleared after approval');

  // --- destructive -> pending -> DENY -> isError, no mutation (AC-3) -------
  board.push({ id: 'tX', text: 'keep me' });
  const denyP = client.callTool({ name: 'delete_all_tasks', arguments: {} });
  const pend2 = await firstPending();
  await decide(pend2.id, false);
  const denied = await denyP;
  assert(denied.isError === true, 'SC-6 denied destructive call returns isError to agent');
  assert(board.length === 1, 'board unchanged after deny');

  // --- anti self-approve: wrong token -> 403 (AC-4) ------------------------
  const badP = client.callTool({ name: 'delete_all_tasks', arguments: {} });
  const pend3 = await firstPending();
  const bad = await decide(pend3.id, true, 'WRONG-TOKEN');
  assert(bad.status === 403, `SC-6 decide with wrong approver-token -> 403 (got ${bad.status})`);
  await decide(pend3.id, false); // clean up the pending
  await badP.catch(() => {});

  // --- fidelity: hidden unicode flagged, canonical executes (AC-5) ---------
  const tamperP = client.callTool({ name: 'bulk_delete', arguments: { ids: ['t1​​'] } });
  const pend4 = await firstPending();
  assert(pend4 && pend4.tampered === true, 'SC-6 tampered args flagged (raw ≠ canonical)');
  assert(pend4.canonical.ids[0] === 't1', `SC-6 canonical strips hidden unicode (got: ${JSON.stringify(pend4.canonical)})`);
  await decide(pend4.id, false);
  await tamperP.catch(() => {});

  // --- audit (AC-6) ---------------------------------------------------------
  const audit = readFileSync('audit.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert(audit.some((e) => e.decision === 'pending'), 'SC-6 audit.jsonl records intent (pending)');
  assert(audit.some((e) => e.decision === 'allow' && e.approver === 'ui'), 'SC-6 audit.jsonl records approved outcome');
  assert(audit.some((e) => e.decision === 'deny'), 'SC-6 audit.jsonl records denied outcome');

  // --- bubble path drives a WRITE tool through the SAME gate -----------------
  const stub = await startStubLLM('add_task', { text: 'from-bubble' });
  const stubURL = `http://127.0.0.1:${stub.port}/v1`;
  const chatWrite = await runChat(stubURL, 'stub-model', 'add a task');
  assert(chatWrite.status === 200, `SC-5 /chat streamed ok (got ${chatWrite.status})`);
  assert(board.some((t) => t.text === 'from-bubble'), 'SC-5 chat tool call landed on the board via the gate');

  // --- SC-3: the model sees the On-screen block with bound state, no read tools
  const stubQ = await startStubLLM(null, null); // answer-only turn
  await runChat(`http://127.0.0.1:${stubQ.port}/v1`, 'stub-model', 'what tasks are on screen?');
  const seen = stubQ.payloads[0] ?? {};
  const sysMsg = (seen.messages ?? []).find((m) => m.role === 'system');
  assert(sysMsg && sysMsg.content.includes('On-screen now'), 'SC-3 system block "On-screen now" reaches the model');
  assert(sysMsg && sysMsg.content.includes('<embinder:data>') && sysMsg.content.includes('from-bubble'),
    'SC-3 bound state (current tasks) is in the system block, data-delimited');
  const offeredTools = (seen.tools ?? []).map((t) => t.function?.name ?? t.name);
  assert(!offeredTools.some((t) => t.startsWith('list_')) && !offeredTools.includes('task_board'),
    `SC-3 no synthetic read tools offered to the model (got: ${offeredTools.join(', ')})`);
  stubQ.server.close();

  // --- destructive from the bubble PAUSES at the gate, then approves ---------
  const stub2 = await startStubLLM('delete_all_tasks', {});
  const stub2URL = `http://127.0.0.1:${stub2.port}/v1`;
  const chatDestructiveP = runChat(stub2URL, 'stub-model', 'clear everything');
  const chatPend = await firstPending();
  assert(chatPend && chatPend.tool === 'delete_all_tasks', 'SC-6 chat destructive call paused at the gate');
  await decide(chatPend.id, true);
  await chatDestructiveP;
  assert(board.length === 0, 'SC-6 chat destructive call ran after approval');

  // --- baseURL outside the allowlist is rejected (SSRF guard) ----------------
  const badBase = await runChat('http://evil.example.com/v1', 'stub-model', 'hi');
  assert(badBase.status === 400, `off-allowlist baseURL -> 400 (got ${badBase.status})`);

  stub.server.close();
  stub2.server.close();

  // --- SC-2: NAVIGATION — Board unmounts, Archive mounts; context switches ---
  unmountBoard();
  mountArchive();
  await sleep(GRACE_MS + 500); // grace window must expire before the Board set is really gone
  tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert(ARCHIVE_TOOLS.every((t) => tools.includes(t)) && !BOARD_TOOLS.some((t) => tools.includes(t)),
    `SC-2 after navigation the agent sees ONLY the Archive set (got: ${tools.join(', ')})`);

  // model-side view switches too: archive state in, board tools out
  const stubA = await startStubLLM(null, null);
  await runChat(`http://127.0.0.1:${stubA.port}/v1`, 'stub-model', 'what is here?');
  const seenA = stubA.payloads[0] ?? {};
  const sysA = (seenA.messages ?? []).find((m) => m.role === 'system');
  assert(sysA && sysA.content.includes('archived thing') && !sysA.content.includes('task_board'),
    'SC-2 model system block now shows the Archive context, not the Board');
  stubA.server.close();

  // --- SC-4: unmount mid-call -> defined error after grace, not a 30s timeout
  muteRestore = true;
  const t0 = Date.now();
  const midCallP = client.callTool({ name: 'restore_task', arguments: { id: 'a1' } });
  await sleep(100);
  unreg('restore_task'); // the page closed under the agent
  const midCall = await midCallP;
  const elapsed = Date.now() - t0;
  assert(midCall.isError === true && JSON.stringify(midCall.content).includes('left the screen'),
    `SC-4 mid-call unmount rejects with "left the screen" (got: ${JSON.stringify(midCall.content).slice(0, 120)})`);
  assert(elapsed < 10_000, `SC-4 rejection came from grace expiry, not the 30s timeout (${elapsed}ms)`);

  // --- SC-4: re-register within grace -> call survives via re-delivery -------
  reg('restore_task', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, {});
  await sleep(100);
  const surviveP = client.callTool({ name: 'restore_task', arguments: { id: 'a2' } });
  await sleep(100);
  unreg('restore_task');       // unmount…
  await sleep(300);
  muteRestore = false;         // remount answers calls again
  reg('restore_task', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, {});
  const survived = JSON.parse((await surviveP).content[0].text);
  assert(survived.ok === true && survived.restored === 'a2',
    `SC-4 remount within grace re-delivers the pending call (got: ${JSON.stringify(survived)})`);

  // --- churn: rapid mount/unmount cycles leak nothing ------------------------
  for (let i = 0; i < 20; i++) {
    unreg('purge_archive');
    reg('purge_archive', { type: 'object', properties: {} }, { destructiveHint: true });
  }
  await sleep(GRACE_MS + 500);
  tools = (await client.listTools()).tools.map((t) => t.name);
  assert(tools.filter((t) => t === 'purge_archive').length === 1 && tools.includes('restore_task'),
    `churn: registry converges to exactly one entry per capability (got: ${tools.join(', ')})`);

  // --- D-9: relay-owned bubble config ----------------------------------------
  const chatCfg = await (await fetch(`${BASE}/chat-config`)).json();
  assert(chatCfg.baseURL === 'http://127.0.0.1:4242/v1' && chatCfg.model === 'demo-model',
    `D-9 /chat-config serves relay env LLM config (got: ${JSON.stringify(chatCfg)})`);

  // --- /approver-token is off unless explicitly enabled ----------------------
  const tokOff = await fetch(`${BASE}/approver-token`);
  assert(tokOff.status === 403, `/approver-token disabled by default -> 403 (got ${tokOff.status})`);

  // --- CORS preflight for the browser bubble ---------------------------------
  const pre = await fetch(`${BASE}/chat`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
  });
  assert(pre.status === 204, `CORS preflight -> 204 (got ${pre.status})`);
  assert(pre.headers.get('access-control-allow-origin') === 'http://localhost:5173', 'preflight echoes the app origin');

  const pocketBasePre = await fetch(`${BASE}/chat`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://127.0.0.1:8090', 'Access-Control-Request-Method': 'POST' },
  });
  assert(pocketBasePre.status === 204, `PocketBase CORS preflight -> 204 (got ${pocketBasePre.status})`);
  assert(
    pocketBasePre.headers.get('access-control-allow-origin') === 'http://127.0.0.1:8090',
    'preflight echoes the PocketBase origin',
  );
} finally {
  await client?.close().catch(() => {});
  await client2?.close().catch(() => {});
  ws?.close();
  relay.kill();
}

console.log(failures === 0 ? '\n✅ E2E + GATE GREEN' : `\n❌ ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
