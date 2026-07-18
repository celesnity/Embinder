import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';
import { fireCheckbox } from './dispatch.js';

export type AgentCheckboxProps = AgentSharedProps & ComponentPropsWithoutRef<'input'>;

/** Agent-aware checkbox: the agent sets checked; the developer's onChange fires. */
export const AgentCheckbox = createAgentElement<'input', HTMLInputElement, { checked: boolean }>({
  tag: 'input',
  fixedProps: { type: 'checkbox' },
  input: { checked: z.boolean().describe('The desired checked state') },
  execute: (el, { checked }) => fireCheckbox(el, checked),
  readState: (el) => ({ checked: el.checked, disabled: el.disabled }),
});
