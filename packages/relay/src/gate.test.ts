// Gate audit classification for unmount-cancelled approvals (D-6).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gate } from './gate.js';
import { cancelByTool } from './approval.js';

describe('gate', () => {
  it('audits an unmount-cancelled approval as approver "unmounted"', async () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), 'embinder-')), 'audit.jsonl');
    const controller = new AbortController();
    const pending = gate('delete_task', { id: 't1' }, 'destructive', controller.signal, {
      auditPath,
    });
    await new Promise((r) => setTimeout(r, 20)); // let the approval enqueue
    cancelByTool('delete_task');
    await expect(pending).rejects.toThrow('unmounted');
    const lines = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const outcome = lines.find((l) => l.decision === 'deny');
    expect(outcome?.approver).toBe('unmounted');
  });
});
