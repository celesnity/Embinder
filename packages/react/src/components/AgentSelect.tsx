import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';
import { fireSelectValue } from './dispatch.js';

export type AgentSelectProps = AgentSharedProps & ComponentPropsWithoutRef<'select'>;

/** Agent-aware <select>: the agent picks an option value; unknown values no-op. */
export const AgentSelect = createAgentElement<'select', HTMLSelectElement, { value: string }>({
  tag: 'select',
  input: { value: z.string().describe('The option value to select') },
  execute: (el, { value }) => {
    const known = Array.from(el.options).some((o) => o.value === value);
    if (known) fireSelectValue(el, value);
  },
  readState: (el) => ({
    value: el.value,
    options: Array.from(el.options).map((o) => o.value),
    disabled: el.disabled,
  }),
});
