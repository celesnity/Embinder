// Policy gate — the core differentiator (Module D).
// T-D1: gate() runs inside the wrapped registerTool handler, AFTER SDK input-validation,
//       BEFORE forwarding to the browser app.
// T-D2: pause/resume — destructive calls block on a human decision.
//
// TODO(T-D1/D2): wire to approval surface (approval.ts) and audit (audit.ts).

import type { Risk } from './policy.js';

export async function gate(
  _name: string,
  _args: unknown,
  risk: Risk,
  signal: AbortSignal,
): Promise<void> {
  if (risk !== 'destructive') return; // read/write in-policy: pass straight through
  if (signal.aborted) throw new Error('aborted');
  // TODO(T-E1): const ok = await askHuman({ name, args: canonicalize(args), signal });
  // if (!ok) throw new Error(`Call to "${name}" denied by policy gate`);
  throw new Error('gate: approval surface not implemented yet (T-E1)');
}
