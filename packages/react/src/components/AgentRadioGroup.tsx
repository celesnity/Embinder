// packages/react/src/components/AgentRadioGroup.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { z } from 'zod';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';

export type AgentRadioGroupProps = AgentSharedProps & ComponentPropsWithoutRef<'div'>;

function radios(el: HTMLDivElement): HTMLInputElement[] {
  return Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
}

/** Agent-aware radio group: one { value } tool that checks the matching child radio. */
export const AgentRadioGroup = createAgentElement<'div', HTMLDivElement, { value: string }>({
  tag: 'div',
  fixedProps: { role: 'radiogroup' },
  input: { value: z.string().describe('The value of the radio option to select') },
  execute: (el, { value }) => {
    const target = radios(el).find((r) => r.value === value);
    if (target && !target.checked) target.click();
  },
  readState: (el) => {
    const rs = radios(el);
    return { value: rs.find((r) => r.checked)?.value ?? '', options: rs.map((r) => r.value) };
  },
});
