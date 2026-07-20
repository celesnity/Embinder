// CapabilityRegistry — the relay's source of truth for what's on screen right now.
// Render-scoped membership (D-1) with grace semantics on unregister (D-6): a quick
// remount cancels removal and pending calls are re-delivered; expiry rejects them
// with a defined error instead of letting the 30 s call timeout fire.

import type { ZodRawShape } from 'zod';
import { ScopeTree, type ScopeResult } from './scope-tree.js';

export interface CapabilityDef {
  config: { description?: string; inputSchema?: ZodRawShape; annotations?: Record<string, unknown> };
  destructive: boolean;
  /** Latest bound-state snapshot from the app (D-4). */
  contextState?: unknown;
  contextTs?: number;
  scopeId?: string;
}

export interface RegistryHooks {
  /** Grace window after unregister before the capability really leaves (D-6). */
  graceMs?: number;
  /** Timeout for a forwarded call with no result while the capability stays mounted. */
  callTimeoutMs?: number;
  /** Fired when a capability is (re)registered — fan out to live agent sessions. */
  onAdd?: (name: string, def: CapabilityDef) => void;
  /** Fired when the grace window expires — remove from sessions, cancel approvals. */
  onRemove?: (name: string) => void;
  /** Fired when a pending call should be re-delivered after a remount within grace. */
  onResend?: (id: string, name: string, args: unknown) => void;
}

interface PendingCall {
  id: string;
  name: string;
  args: unknown;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class CapabilityRegistry {
  private defs = new Map<string, CapabilityDef>();
  private grace = new Map<string, ReturnType<typeof setTimeout>>();
  private calls = new Map<string, PendingCall>();
  private graceMs: number;
  private callTimeoutMs: number;
  private hooks: RegistryHooks;
  private scopes = new ScopeTree();

  constructor(hooks: RegistryHooks = {}) {
    this.hooks = hooks;
    this.graceMs = hooks.graceMs ?? 2000;
    this.callTimeoutMs = hooks.callTimeoutMs ?? 30_000;
  }

  register(name: string, def: CapabilityDef): void {
    const timer = this.grace.get(name);
    const remount = timer !== undefined;
    if (timer) {
      clearTimeout(timer);
      this.grace.delete(name);
    }
    // A re-register keeps the last context snapshot until the new mount pushes one.
    const prev = this.defs.get(name);
    if (prev?.contextState !== undefined && def.contextState === undefined) {
      def.contextState = prev.contextState;
      def.contextTs = prev.contextTs;
    }
    this.defs.set(name, def);
    this.hooks.onAdd?.(name, def);
    if (remount) {
      for (const call of this.calls.values()) {
        if (call.name === name) this.hooks.onResend?.(call.id, call.name, call.args);
      }
    }
  }

  unregister(name: string): void {
    if (!this.defs.has(name) || this.grace.has(name)) return;
    this.grace.set(
      name,
      setTimeout(() => {
        this.grace.delete(name);
        this.defs.delete(name);
        for (const [id, call] of this.calls) {
          if (call.name !== name) continue;
          this.calls.delete(id);
          if (call.timer) clearTimeout(call.timer);
          call.reject(new Error(`capability "${name}" left the screen`));
        }
        this.hooks.onRemove?.(name);
      }, this.graceMs),
    );
  }

  setContext(name: string, state: unknown): void {
    const def = this.defs.get(name);
    if (!def) return;
    def.contextState = state;
    def.contextTs = Date.now();
  }

  get(name: string): CapabilityDef | undefined {
    return this.defs.get(name);
  }

  entries(): IterableIterator<[string, CapabilityDef]> {
    return this.defs.entries();
  }

  registerScope(scope: { id: string; parentId?: string; name: string }): void { this.scopes.register(scope); }
  setScopeContext(id: string, state: unknown): void { this.scopes.setContext(id, state); }
  unregisterScope(id: string): void { this.scopes.unregister(id); }
  selectedEntries(session: string): Array<[string, CapabilityDef]> {
    const visible = this.scopes.visible(this.entries(), session);
    const focus = this.scopes.focusable(session).map((scope) => [
      `focus_${scope.id.replaceAll('/', '__')}`,
      { config: { description: `Focus ${scope.name}`, inputSchema: {} }, destructive: false } as CapabilityDef,
    ] as [string, CapabilityDef]);
    return [...visible, ...focus];
  }
  allEntries(): Array<[string, CapabilityDef]> {
    return [...this.defs, ...this.scopes.allFocusable().map((scope) => [
      `focus_${scope.id.replaceAll('/', '__')}`,
      { config: { description: `Focus ${scope.name}`, inputSchema: {} }, destructive: false } as CapabilityDef,
    ] as [string, CapabilityDef])];
  }
  focus(session: string, name: string): ScopeResult {
    const id = name.startsWith('focus_') ? name.slice(6).replaceAll('__', '/') : '';
    return this.scopes.focus(session, id);
  }
  reserveScopedAction(session: string, name: string): { scoped: boolean; ok: boolean; error?: string } {
    const def = this.defs.get(name);
    if (!def?.scopeId) return { scoped: false, ok: true };
    const result = this.scopes.reserve(session, def.scopeId);
    return result.ok ? { scoped: true, ok: true } : { scoped: true, ok: false, error: result.error };
  }
  settleScopedAction(session: string): void { this.scopes.settle(session); }

  trackCall(call: Omit<PendingCall, 'timer'>): void {
    const pending: PendingCall = { ...call };
    pending.timer = setTimeout(() => {
      this.calls.delete(call.id);
      pending.reject(new Error(`tool "${call.name}" timed out`));
    }, this.callTimeoutMs);
    this.calls.set(call.id, pending);
  }

  settle(id: string, result: unknown): void {
    const call = this.calls.get(id);
    if (!call) return;
    this.calls.delete(id);
    if (call.timer) clearTimeout(call.timer);
    call.resolve(result);
  }
}
