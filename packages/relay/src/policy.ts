// Policy engine — reads minder.policy.json (authoritative) and resolves per-tool risk.
// T-D1: policy.riskOf(name, destructiveHintDefault) -> "read" | "write" | "destructive".
// Rule: policy.json wins; unknown tools are deny-by-default ("destructive").

import { readFileSync } from 'node:fs';

export type Risk = 'read' | 'write' | 'destructive';

export interface Policy {
  tools?: Record<string, Risk>;
  unknownTool?: Risk;
  rateLimit?: { perToolPerMin?: number };
}

export function loadPolicy(path: string): Policy {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Policy;
  } catch {
    return {};
  }
}

// destructiveHint is only a first-party DEFAULT; policy.json overrides it.
export function riskOf(policy: Policy, name: string, destructiveHint = false): Risk {
  const declared = policy.tools?.[name];
  if (declared) return declared;
  if (destructiveHint) return 'destructive';
  return policy.unknownTool ?? 'destructive';
}
