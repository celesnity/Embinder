// Approval surface (Module E) — pending-approval registry + arg canonicalization.
// Served OUTSIDE the agent-driven app tab (anti self-approve, AC-4). HTTP routes live in
// approval-routes.ts; this module is the transport-agnostic core so it stays unit-testable.

import { createInterface } from 'node:readline';

// ---- T-E2: approval-view fidelity -------------------------------------------
// Strip Tag block (U+E0000–U+E007F), zero-width, and bidi control characters, then NFC.
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

// ---- pending-approval registry ----------------------------------------------
export interface PendingApproval {
  id: string;
  tool: string;
  risk: string;
  session?: string;
  argsRaw: unknown;
  argsCanonical: unknown;
  tampered: boolean;
  createdAt: number;
  resolve: (approver: string) => void;
  reject: (err: Error) => void;
}

// Shape sent to approval UIs (no promise handles).
export interface PublicPending {
  id: string;
  tool: string;
  risk: string;
  session?: string;
  raw: unknown;
  canonical: unknown;
  tampered: boolean;
  createdAt: number;
}

type Event = { type: 'add' | 'remove'; pending: PublicPending };
type Listener = (e: Event) => void;

const queue = new Map<string, PendingApproval>();
const listeners = new Set<Listener>();

function toPublic(p: PendingApproval): PublicPending {
  return {
    id: p.id,
    tool: p.tool,
    risk: p.risk,
    session: p.session,
    raw: p.argsRaw,
    canonical: p.argsCanonical,
    tampered: p.tampered,
    createdAt: p.createdAt,
  };
}

function emit(type: Event['type'], p: PendingApproval) {
  const pending = toPublic(p);
  for (const l of listeners) l({ type, pending });
}

export function listPending(): PublicPending[] {
  return [...queue.values()].map(toPublic);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  risk: string;
  session?: string;
  argsRaw: unknown;
  argsCanonical: unknown;
  tampered: boolean;
}

// Blocks until a human decides. Resolves with the approver id, rejects on deny/abort.
export function requestApproval(req: ApprovalRequest, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const p: PendingApproval = { ...req, createdAt: Date.now(), resolve, reject };
    queue.set(p.id, p);
    emit('add', p);
    signal.addEventListener(
      'abort',
      () => {
        if (queue.delete(p.id)) {
          emit('remove', p);
          reject(new Error('cancelled by agent'));
        }
      },
      { once: true },
    );
  });
}

// Called by the approval routes / CLI. Returns false if the id is unknown (already decided).
export function decide(id: string, approve: boolean, approver: string): boolean {
  const p = queue.get(id);
  if (!p) return false;
  queue.delete(id);
  emit('remove', p);
  if (approve) p.resolve(approver);
  else p.reject(new Error(`Call to "${p.tool}" denied by policy gate`));
  return true;
}

// ---- CLI fallback (T-E1) ----------------------------------------------------
// When stdin is a TTY, approve/deny the oldest pending with [a]/[d].
export function enableCliApprovals(): void {
  if (!process.stdin.isTTY) return;
  subscribe((e) => {
    if (e.type !== 'add') return;
    const flag = e.pending.tampered ? ' ⚠️  TAMPERED (hidden unicode stripped)' : '';
    console.log(
      `\n[embinder] APPROVE "${e.pending.tool}"?  args=${JSON.stringify(e.pending.canonical)}${flag}` +
        `\n         [a]pprove / [d]eny  (or use http://127.0.0.1:7331/approve)`,
    );
  });
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const oldest = [...queue.keys()][0];
    if (!oldest) return;
    const c = line.trim().toLowerCase();
    if (c.startsWith('a')) decide(oldest, true, 'cli');
    else if (c.startsWith('d')) decide(oldest, false, 'cli');
  });
}
