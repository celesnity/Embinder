// Ghost-cursor tour: drives a sequence of agent tool calls through the relay so the ghost
// mascot glides between on-screen targets while you watch the app at http://localhost:5173.
// Run: node scripts/ghost-tour.mjs   (the app must be open in a browser first)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP = 'http://127.0.0.1:7331/mcp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new Client({ name: 'ghost-tour', version: '0.0.1' });
await client.connect(new StreamableHTTPClientTransport(new URL(MCP)));

// Wait until the browser app has registered its tools (proves a page is open).
let names = [];
for (let i = 0; i < 20; i++) {
  names = (await client.listTools()).tools.map((t) => t.name);
  if (names.includes('set_search')) break;
  await sleep(500);
}
if (!names.includes('set_search')) {
  console.error('\n⚠️  No app tools found — open http://localhost:5173 in a browser first, then re-run.\n');
  process.exit(1);
}
console.log('App connected. Tools visible:', names.length);

async function call(name, args, note) {
  console.log(`\n→ ${name} ${JSON.stringify(args)}  — ${note}`);
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? JSON.stringify(r);
    console.log(`  ${r.isError ? '✗' : '✓'} ${text.slice(0, 120)}`);
  } catch (e) {
    console.log(`  ✗ ${String(e).slice(0, 120)}`);
  }
}

// A slow tour so the glide between distant targets is easy to watch.
await call('set_view', { view: 'board' }, 'glide to the view toggle (board)');
await sleep(2500);
await call('set_search', { value: 'design' }, 'glide to the AgentInput search box + type');
await sleep(2500);
await call('clear_filter', {}, 'glide to the clear-filter chip');
await sleep(2500);
await call('mark_all_done', {}, 'glide to the Mark-all-done AgentButton');
await sleep(2500);
await call('undo', {}, 'glide to the Undo AgentButton');
await sleep(2500);
await call('scroll_to', { section: 'by-priority' }, 'scroll the board, ghost follows');
await sleep(3000);
await call('go_to_page', { page: 'settings' }, 'navigate to Settings');
await sleep(2500);
await call('scroll_to', { section: 'danger-zone' }, 'scroll to the danger zone');
await sleep(3000);
await call('delete_all_tasks', {}, 'DESTRUCTIVE — ghost glows and waits at the gate; Approve/Deny on screen in the app tab');

console.log('\nTour done. (delete_all_tasks is waiting for your on-screen Approve/Deny in the app tab)');
await client.close().catch(() => {});
process.exit(0);
