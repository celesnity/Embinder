import { type ReactElement, type ReactNode } from 'react';
import { type ZodTypeAny } from 'zod';
export interface AgentAction<T> {
    description: string;
    destructive?: boolean;
    title?: string;
    /** Zod raw shape for extra agent args beyond the item id. Omitted => id-only. */
    input?: Record<string, ZodTypeAny>;
    /** Runs the action for the resolved item; args is the extra input ({} when none). */
    run: (item: T, args: Record<string, unknown>) => unknown | Promise<unknown>;
}
export interface AgentListProps<T> {
    /** Collection id — namespaces the tools (`${key}_${name}`) and context (`${name}_items`). */
    name: string;
    items: T[];
    /** Stable, unique id per item. The agent targets items by this. */
    getId: (item: T) => string;
    /** Human label per item, surfaced to the agent in the `${name}_items` context. */
    describe: (item: T) => string;
    actions: Record<string, AgentAction<T>>;
    renderItem: (item: T, anchor: {
        'data-embinder-item': string;
    }) => ReactNode;
}
export declare function AgentList<T>({ name, items, getId, describe, actions, renderItem, }: AgentListProps<T>): ReactElement;
