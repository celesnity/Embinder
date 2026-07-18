// Approval surface (Module E) — served OUTSIDE the agent-driven app tab (anti self-approve).
// T-E1: GET /approve UI + GET /api/pending + POST /api/decide {id, approve}.
// T-E2: approval-view fidelity — canonicalize args (NFC + strip invisible Unicode) and
//       show raw vs canonical; execute the canonical bytes only.
//
// TODO(T-E1/E2): implement pending-queue, HTTP routes, and canonicalize().

// Strip Tag block (U+E0000–U+E007F), zero-width, and bidi control characters.
export function stripInvisible(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[​-‍﻿‪-‮⁦-⁩]/g, '')
    .replace(/[\u{E0000}-\u{E007F}]/gu, '');
}

export function canonicalize<T>(value: T): T {
  if (typeof value === 'string') return stripInvisible(value) as unknown as T;
  if (Array.isArray(value)) return value.map(canonicalize) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, canonicalize(v)]),
    ) as T;
  }
  return value;
}
