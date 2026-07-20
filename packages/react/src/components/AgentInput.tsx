import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';
import { fireInputValue } from './dispatch.js';

export type AgentInputProps = AgentSharedProps & ComponentPropsWithoutRef<'input'>;

/** Agent-aware <input>: the agent sets its value; the developer's onChange fires. */
export const AgentInput = createAgentElement<'input', HTMLInputElement, { value: string }>({
  tag: 'input',
  input: { value: z.string().describe('The value to type into the field') },
  execute: (el, { value }) => fireInputValue(el, value),
  readState: (el) => ({ value: el.value, placeholder: el.placeholder, disabled: el.disabled }),
});
