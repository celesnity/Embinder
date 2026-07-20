import type { CapabilityDef } from './registry.js';

interface ScopeDef { id: string; parentId?: string; name: string; contextState?: unknown; }
interface Lease { scopeId: string; reserved: boolean; }
export type ScopeResult = { ok: true; state: unknown } | { ok: false; error: string };

export class ScopeTree {
  private scopes = new Map<string, ScopeDef>();
  private leases = new Map<string, Lease>();
  constructor(private maxDepth = 3) {}
  register(scope: Omit<ScopeDef, 'contextState'>) { this.scopes.set(scope.id, { ...scope, contextState: this.scopes.get(scope.id)?.contextState }); }
  setContext(id: string, state: unknown) { const s = this.scopes.get(id); if (s) s.contextState = state; }
  unregister(id: string) { const gone = [...this.scopes.keys()].filter((x) => x === id || x.startsWith(`${id}/`)); gone.forEach((x) => this.scopes.delete(x)); for (const [session, lease] of this.leases) if (gone.includes(lease.scopeId)) this.leases.delete(session); }
  focus(session: string, id: string): ScopeResult {
    const scope = this.scopes.get(id); const parent = this.leases.get(session)?.scopeId;
    if (!scope || scope.parentId !== parent || id.split('/').length > this.maxDepth) return { ok: false, error: 'scope is not discoverable from current context' };
    this.leases.set(session, { scopeId: id, reserved: false }); return { ok: true, state: scope.contextState ?? {} };
  }
  reserve(session: string, scopeId: string): ScopeResult {
    const lease = this.leases.get(session);
    if (!lease || lease.scopeId !== scopeId) return { ok: false, error: 'tool is outside focused scope' };
    if (lease.reserved) return { ok: false, error: 'scope action already reserved' };
    lease.reserved = true; return { ok: true, state: {} };
  }
  settle(session: string) { this.leases.delete(session); }
  visible(entries: Iterable<[string, CapabilityDef]>, session: string) { const scopeId = this.leases.get(session)?.scopeId; return [...entries].filter(([, def]) => def.scopeId === scopeId); }
  focusable(session: string): ScopeDef[] { const parent = this.leases.get(session)?.scopeId; return [...this.scopes.values()].filter((s) => s.parentId === parent && s.id.split('/').length <= this.maxDepth); }
  allFocusable(): ScopeDef[] { return [...this.scopes.values()].filter((s) => s.id.split('/').length <= this.maxDepth); }
}
