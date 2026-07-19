// packages/react/src/components/AgentList.tsx
// Declarative agent-drivable collection. Renders items with a per-id anchor and registers,
// per action, a headless child that makes ONE useEmbinder call (reuses the existing
// registration/gate/context machinery; a keyed list of single-hook children avoids the
// rules-of-hooks hazard of calling useEmbinder in a loop). One context-only pointer
// (`${name}_items`) lets the agent enumerate ids. Tool count is O(actions), not O(items).
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { z, type ZodTypeAny } from 'zod';
import { useEmbinder } from '../use-embinder.js';

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
  renderItem: (item: T, anchor: { 'data-embinder-item': string }) => ReactNode;
}

// One static useEmbinder call. Rendered once per action; a keyed list of these is safe
// (each child owns exactly one hook), unlike calling useEmbinder in a loop.
function ItemToolRegistrar<T>(props: {
  toolName: string;
  action: AgentAction<T>;
  items: T[];
  getId: (item: T) => string;
}): null {
  const { toolName, action, items, getId } = props;
  useEmbinder({
    name: toolName,
    title: action.title,
    description: action.description,
    destructive: action.destructive,
    input: { id: z.string().describe('The id of the target item'), ...(action.input ?? {}) },
    handler: ((args: { id: string } & Record<string, unknown>) => {
      const { id, ...rest } = args;
      const item = items.find((it) => getId(it) === id);
      if (!item) return { error: 'item_not_found', id };
      return action.run(item, rest);
    }) as (args: never) => unknown,
  });
  return null;
}

function CollectionContext<T>(props: {
  name: string;
  items: T[];
  getId: (item: T) => string;
  describe: (item: T) => string;
}): null {
  const { name, items, getId, describe } = props;
  useEmbinder({
    name,
    description: 'The current items in this collection (id + label). Use an id with the action tools.',
    context: () => ({ items: items.map((it) => ({ id: getId(it), label: describe(it) })) }),
  });
  return null;
}

export function AgentList<T>({
  name,
  items,
  getId,
  describe,
  actions,
  renderItem,
}: AgentListProps<T>): ReactElement {
  return (
    <>
      {Object.entries(actions).map(([key, action]) => (
        <ItemToolRegistrar key={key} toolName={`${key}_${name}`} action={action} items={items} getId={getId} />
      ))}
      <CollectionContext name={`${name}_items`} items={items} getId={getId} describe={describe} />
      {items.map((item) => (
        <Fragment key={getId(item)}>{renderItem(item, { 'data-embinder-item': String(getId(item)) })}</Fragment>
      ))}
    </>
  );
}
