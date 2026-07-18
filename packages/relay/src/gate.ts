// Policy gate (Module D) — the core differentiator.
// Runs inside the wrapped registerTool handler, AFTER SDK input-validation, BEFORE forward.
//   - read / write in-policy  -> pass through
//   - destructive / unknown   -> pause on a human decision (T-D2)
// Also enforces rate limit (T-F2), canonicalizes args for fidelity (T-E2), and audits (T-F1).
// Returns the CANONICAL args to forward — the clean bytes execute, not the raw ones.

import { randomUUID } from 'node:crypto';
import type { Risk } from './policy.js';
import { canonicalize, requestApproval } from './approval.js';
import { audit } from './audit.js';

export interface GateCtx {
  session?: string;
  auditPath: string;
  rateLimitPerMin?: number;
  keepAlive?: () => void; // called ~every 15s while waiting, to keep the MCP stream alive
}

// ---- rate limit (T-F2) ------------------------------------------------------
const windows = new Map<string, number[]>(); // key `session:tool` -> call timestamps (ms)

function rateLimited(session: string | undefined, tool: string, perMin: number): boolean {
  if (!perMin || perMin <= 0) return false;
  const key = `${session ?? 'anon'}:${tool}`;
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  windows.set(key, hits);
  return hits.length > perMin;
}

export async function gate(
  name: string,
  argsRaw: unknown,
  risk: Risk,
  signal: AbortSignal,
  ctx: GateCtx,
): Promise<unknown> {
  const argsCanonical = canonicalize(argsRaw);
  const tampered = JSON.stringify(argsRaw) !== JSON.stringify(argsCanonical);
  const started = Date.now();
  const base = { ts: new Date().toISOString(), session: ctx.session, tool: name, argsRaw, argsCanonical };

  // Rate limit applies to every call.
  if (rateLimited(ctx.session, name, ctx.rateLimitPerMin ?? 0)) {
    audit(ctx.auditPath, { ...base, decision: 'deny', approver: 'rate-limit', latencyMs: 0 });
    throw new Error(`Rate limit exceeded for "${name}"`);
  }

  // read / write in-policy: straight through.
  if (risk !== 'destructive') {
    audit(ctx.auditPath, { ...base, decision: 'allow', latencyMs: 0 });
    return argsCanonical;
  }

  if (signal.aborted) throw new Error('aborted');

  const id = randomUUID();
  audit(ctx.auditPath, { ...base, decision: 'pending', latencyMs: 0 }); // intent

  // Keep the MCP stream alive while a human decides (no hard deadline here, T-D2 decision #2).
  const ticker = ctx.keepAlive ? setInterval(() => ctx.keepAlive!(), 15_000) : undefined;
  try {
    const approver = await requestApproval(
      { id, tool: name, risk, session: ctx.session, argsRaw, argsCanonical, tampered },
      signal,
    );
    audit(ctx.auditPath, { ...base, decision: 'allow', approver, latencyMs: Date.now() - started });
    return argsCanonical;
  } catch (err) {
    audit(ctx.auditPath, {
      ...base,
      decision: 'deny',
      approver: (err as Error).message.includes('cancelled') ? 'agent-cancel' : 'human',
      latencyMs: Date.now() - started,
    });
    throw err;
  } finally {
    if (ticker) clearInterval(ticker);
  }
}
