import { type ComponentPropsWithoutRef } from 'react';
import type { ZodTypeAny } from 'zod';
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
export declare function createAgentElement<T extends AgentTag, E extends HTMLElement, A>(adapter: AgentAdapter<T, E, A>): import("react").ForwardRefExoticComponent<import("react").PropsWithoutRef<AgentSharedProps & ComponentPropsWithoutRef<T>> & import("react").RefAttributes<E>>;
