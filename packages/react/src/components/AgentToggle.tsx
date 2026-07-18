// packages/react/src/components/AgentToggle.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';
import { clickIfState } from './dispatch.js';

export type AgentToggleProps = AgentSharedProps & ComponentPropsWithoutRef<'button'>;

const isOn = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true';

/** Agent-aware switch (<button role="switch">): the agent sets { on } by clicking. */
export const AgentToggle = createAgentElement<'button', HTMLButtonElement, { on: boolean }>({
  tag: 'button',
  fixedProps: { role: 'switch' },
  input: { on: z.boolean().describe('The desired on/off state') },
  execute: (el, { on }) => clickIfState(el, on, isOn),
  readState: (el) => ({ on: isOn(el), disabled: el.disabled }),
});
