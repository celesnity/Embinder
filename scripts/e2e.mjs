// One-command E2E: proves the tool-call round-trip through the relay bridge.
// Spawns the relay, plays a fake browser app (ws /app) + a real MCP client (/mcp),
// asserts: tools/list has the tool, agent gets {ok:true}, and the app state mutated.
//
//   npm run e2e
//
// This is the real D3 milestone (Inspector -> add_task -> app changes -> result),
// run headlessly so it can gate every future change to the bridge.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const RELAY = 'http://127.0.0.1:7331/mcp';
const APP_WS = 'ws://127.0.0.1:7331/app';

const board = []; // in-memory "browser" state the tool mutates
let failures = 0;
const assert = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

// --- boot relay -------------------------------------------------------------
const relay = spawn('npx', ['tsx', 'packages/relay/src/server.ts'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  const t = globalThis.setTimeout(() => reject(new Error('relay did not start in 10s')), 10_000);
  relay.stdout.on('data', (d) => {
    if (String(d).includes('relay on')) { clearTimeout(t); resolve(); }
  });
});

let ws, client, client2;
try {
  // --- fake browser app: register tool + handle calls ----------------------
  ws = new WebSocket(APP_WS);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('error', () => {}); // swallow teardown EPIPE when the relay is killed
  ws.on('message', (buf) => {
    const m = JSON.parse(String(buf));
    if (m.type === 'call' && m.name === 'add_task') {
      board.push(m.args.text);
      ws.send(JSON.stringify({ type: 'result', id: m.id, result: { ok: true, added: m.args.text } }));
    }
  });
  ws.send(JSON.stringify({
    type: 'register',
    tool: {
      name: 'add_task',
      description: 'Add a new task to the board',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      annotations: { title: 'Add task' },
    },
  }));
  await sleep(200); // let the relay registerGatedTool before we list

  // --- real MCP client ------------------------------------------------------
  client = new Client({ name: 'e2e-probe', version: '0.0.1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(RELAY)));

  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert(tools.includes('add_task'), `tools/list includes add_task (got: ${tools.join(', ')})`);

  const res = await client.callTool({ name: 'add_task', arguments: { text: 'milk' } });
  const payload = JSON.parse(res.content[0].text);
  assert(payload.ok === true, `agent received {ok:true} (got: ${JSON.stringify(payload)})`);
  assert(board.includes('milk'), `task "milk" landed in the app board (board: ${JSON.stringify(board)})`);

  // --- second concurrent session (regresses the "Already connected" bug) ---
  client2 = new Client({ name: 'e2e-probe-2', version: '0.0.1' });
  let secondConnected = true;
  try {
    await client2.connect(new StreamableHTTPClientTransport(new URL(RELAY)));
    const tools2 = (await client2.listTools()).tools.map((t) => t.name);
    assert(tools2.includes('add_task'), `2nd session lists add_task too (got: ${tools2.join(', ')})`);
  } catch (e) {
    secondConnected = false;
    assert(false, `2nd concurrent session connects (got error: ${e.message})`);
  }
  assert(secondConnected, 'two concurrent MCP sessions coexist (per-session McpServer)');
} finally {
  await client?.close().catch(() => {});
  await client2?.close().catch(() => {});
  ws?.close();
  relay.kill();
}

console.log(failures === 0 ? '\n✅ E2E round-trip GREEN' : `\n❌ ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
