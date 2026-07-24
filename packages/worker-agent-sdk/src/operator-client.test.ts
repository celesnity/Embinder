import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOperatorSnapshot, operatorTools } from './operator-client.js';

const cfg = { relayBaseUrl: 'http://relay.test', operatorToken: 'secret' };
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };

afterEach(() => vi.unstubAllGlobals());

describe('operator client', () => {
  it('sends its server-only credential when reading the snapshot', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ tools: [{ name: 'add_task', inputSchema: schema }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(getOperatorSnapshot(cfg)).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith('http://relay.test/internal/operator/snapshot', expect.objectContaining({ headers: { 'x-embinder-operator-token': 'secret' } }));
  });

  it('executes generated AI tools through the relay with the Blackboard task id', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const tools = operatorTools(cfg, 'bb-1', [{ name: 'add_task', inputSchema: schema }]);
    await tools.add_task.execute!({ text: 'milk' }, {} as never);
    expect(fetch).toHaveBeenCalledWith('http://relay.test/internal/operator/call', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ name: 'add_task', args: { text: 'milk' }, taskId: 'bb-1' }),
    }));
  });
});
