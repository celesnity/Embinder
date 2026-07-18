// packages/react/src/components/createAgentElement.tsx
// Internal factory: turns an adapter (element type + how it maps to an MCP tool)
// into an agent-aware React component. Every Agent* component is built from this.
// The component renders the real native element, registers a tool via useEmbinder,
// and pushes live DOM state through the same context() channel.
import { createElement, forwardRef, useCallback, useRef, type ComponentPropsWithoutRef, type Ref } from 'react';
import type { ZodTypeAny } from 'zod';
import { useEmbinder } from '../use-embinder.js';

export interface AgentSharedProps {
  /** Unique per mounted screen. */
  name: string;
  /** Prompt context surfaced to the agent via tools/list. */
  description: string;
  /** Marks the capability destructive (policy file still wins). */
  destructive?: boolean;
  title?: string;
  /** Override the auto live-state selector. */
  context?: () => unknown;
}

export type AgentTag = 'button' | 'input' | 'textarea' | 'select' | 'div' | 'a';

export interface AgentAdapter<T extends AgentTag, E extends HTMLElement, A> {
  tag: T;
  /** Fixed element props merged first (e.g. { type: 'checkbox' }, { role: 'switch' }). */
  fixedProps?: Record<string, unknown>;
  /** Zod raw shape for tool input; omitted => no-arg action. */
  input?: Record<string, ZodTypeAny>;
  /** No handler => context-only pointer (contributes state, never callable). */
  contextOnly?: boolean;
  /** Agent-callable behavior: dispatch native events on the ref. */
  execute?: (el: E, args: A) => void;
  /** Live read-only state, sampled after each commit. */
  readState: (el: E) => unknown;
}

function mergeRefs<T>(a: Ref<T>, b: Ref<T> | undefined) {
  return (value: T | null) => {
    for (const r of [a, b]) {
      if (typeof r === 'function') r(value);
      else if (r && typeof r === 'object') (r as { current: T | null }).current = value;
    }
  };
}

// Generic over the concrete tag T so the returned component keeps element-specific
// props (placeholder, href, checked, ...) instead of the lossy union of all tags.
export function createAgentElement<T extends AgentTag, E extends HTMLElement, A>(
  adapter: AgentAdapter<T, E, A>,
) {
  type Props = AgentSharedProps & ComponentPropsWithoutRef<T>;
  const Component = forwardRef<E, Props>((props, forwardedRef) => {
    const { name, description, destructive, title, context, ...native } = props;
    const ref = useRef<E>(null);
    const bind = useEmbinder({
      name,
      description,
      title,
      destructive,
      input: adapter.input,
      handler: adapter.contextOnly
        ? undefined
        : (args: never) => adapter.execute?.(ref.current as E, args as A),
      context: context ?? (() => (ref.current ? adapter.readState(ref.current) : {})),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const setRef = useCallback(mergeRefs(ref, forwardedRef as Ref<E>), [forwardedRef]);
    return createElement(adapter.tag, {
      ...adapter.fixedProps,
      ...native,
      ...bind,
      ref: setRef,
    });
  });
  return Component;
}
