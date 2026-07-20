import type { ZodTypeAny } from 'zod';
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
export declare function useEmbinder(descriptor: EmbinderDescriptor): EmbinderBind;
