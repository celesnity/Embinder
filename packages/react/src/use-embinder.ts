// useEmbinder — the pointer primitive. One call: registers the capability through the
// provider shim on mount, anchors it to the element via the returned spread props, and
// unregisters on unmount. See docs/ai/design/2026-07-18-feature-embinder-pointer.md.
import { useEffect, useRef } from 'react';
import type { ZodTypeAny } from 'zod';
import { getModelContext } from './model-context.js';
import { sendEmbinderContext } from './provider.js';
import { useAgentScopeId } from './scope-context.js';

const CONTEXT_DEBOUNCE_MS = 150;
const CONTEXT_MAX_BYTES = 16 * 1024;

// Live mount counts per pointer name — duplicate mounted names are a developer error
// (relay semantics are last-mount-wins, so the first pointer silently stops working).
const mounted = new Map<string, number>();

export interface EmbinderBind {
  'data-embinder-tool': string;
}

export interface EmbinderDescriptor {
  /** Unique per mounted screen. */
  name: string;
  description: string;
  /** Zod raw shape, e.g. { text: z.string() }. Omitted => no-arg action. */
  input?: Record<string, ZodTypeAny>;
  /** Agent-callable function (structured args, not DOM events). Omitted => context-only pointer. */
  handler?: (args: never) => unknown | Promise<unknown>;
  /** Live read-only state selector, sampled while mounted. */
  context?: () => unknown;
  /** Marks the capability destructive (policy file still wins). */
  destructive?: boolean;
  title?: string;
}

// The relay's toZodShape reads properties.*.type + required; keep the schema minimal but honest.
function zodToJsonSchema(shape: Record<string, ZodTypeAny>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, zt] of Object.entries(shape)) {
    let inner = zt as ZodTypeAny & { _def: { typeName?: string; innerType?: ZodTypeAny; description?: string } };
    const optional = inner._def.typeName === 'ZodOptional';
    const description = inner.description ?? inner._def.description;
    if (optional) inner = inner._def.innerType as typeof inner;
    const typeName = inner._def.typeName;
    const type =
      typeName === 'ZodNumber' ? 'number'
      : typeName === 'ZodBoolean' ? 'boolean'
      : typeName === 'ZodArray' ? 'array'
      : typeName === 'ZodObject' || typeName === 'ZodRecord' ? 'object'
      : 'string';
    properties[key] = description ? { type, description } : { type };
    if (!optional) required.push(key);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

export function useEmbinder(descriptor: EmbinderDescriptor): EmbinderBind {
  const { name } = descriptor;
  const scopeId = useAgentScopeId();

  // The registration effect runs once per name, but handlers often close over component
  // state — always execute the LATEST render's handler, never the mount-time closure.
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;

  useEffect(() => {
    const surface = getModelContext();
    if (!surface) {
      console.warn(`[embinder] useEmbinder("${name}"): no EmbinderProvider above this component`);
      return;
    }
    const count = (mounted.get(name) ?? 0) + 1;
    mounted.set(name, count);
    if (count > 1) {
      console.error(`[embinder] duplicate embinder pointer name "${name}" is mounted ${count} times — last mount wins`);
    }
    const controller = new AbortController();
    surface.registerTool(
      {
        name: descriptor.name,
        title: descriptor.title,
        description: descriptor.description,
        inputSchema: zodToJsonSchema(descriptor.input ?? {}),
        annotations: {
          ...(descriptor.title ? { title: descriptor.title } : {}),
          ...(descriptor.destructive ? { destructiveHint: true } : {}),
          ...(scopeId ? { embinderScope: scopeId } : {}),
          // No handler => context-only pointer: contributes state, never a callable tool (D-5).
          ...(descriptor.handler ? {} : { embinderContextOnly: true }),
        },
        execute: (args) => (descriptorRef.current.handler as (a: unknown) => unknown)?.(args),
      },
      { signal: controller.signal },
    );
    return () => {
      const left = (mounted.get(name) ?? 1) - 1;
      if (left <= 0) mounted.delete(name);
      else mounted.set(name, left);
      controller.abort();
    };
    // Re-register only when the capability identity changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Bound state (D-4): sample context() after every commit; push a snapshot over the ws
  // only when the JSON-stable value changed, debounced per pointer.
  const contextRef = useRef(descriptor.context);
  contextRef.current = descriptor.context;
  const lastSnapshot = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!contextRef.current) return;
    let json = JSON.stringify(contextRef.current());
    if (json !== undefined && json.length > CONTEXT_MAX_BYTES) {
      console.warn(`[embinder] context for "${name}" exceeds ${CONTEXT_MAX_BYTES} bytes — truncated`);
      json = JSON.stringify('[truncated]');
    }
    if (json === lastSnapshot.current) return;
    lastSnapshot.current = json;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => sendEmbinderContext(name, JSON.parse(json)), CONTEXT_DEBOUNCE_MS);
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  return { 'data-embinder-tool': name };
}
