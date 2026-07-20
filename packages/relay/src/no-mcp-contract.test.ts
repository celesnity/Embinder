import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

describe('no-MCP relay mode', () => {
  it('guards MCP route registration behind an explicit environment flag', () => {
    expect(server).toContain("EMBINDER_ENABLE_MCP");
    expect(server).toContain('if (ENABLE_MCP)');
  });

  it('provides an authenticated direct action route for the embedded host', () => {
    expect(server).toContain("'/internal/direct-call'");
    expect(server).toContain('x-embinder-direct-token');
  });
});
