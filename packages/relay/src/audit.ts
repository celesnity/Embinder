// Audit log (Module F) — append-only audit.jsonl.
// T-F1: one line per call { ts, session, tool, argsRaw, argsCanonical, decision, approver, latencyMs }.
// Written at the gate: intent before forward, outcome after.
//
// TODO(T-F1): wire real fields from the gate; T-F2: rate limiting.

import { appendFileSync } from 'node:fs';

export interface AuditEntry {
  ts: string;
  session?: string;
  tool: string;
  argsRaw?: unknown;
  argsCanonical?: unknown;
  decision: 'allow' | 'deny' | 'pending' | 'error';
  approver?: string;
  latencyMs?: number;
}

export function audit(path: string, entry: AuditEntry): void {
  appendFileSync(path, JSON.stringify(entry) + '\n');
}
