// packages/react/src/components/AgentButton.tsx
import type { ComponentPropsWithoutRef } from 'react';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';

export type AgentButtonProps = AgentSharedProps & ComponentPropsWithoutRef<'button'>;

/** Agent-aware <button>: the agent clicks it; no handler needed. */
export const AgentButton = createAgentElement<'button', HTMLButtonElement, void>({
  tag: 'button',
  execute: (el) => el.click(),
  readState: (el) => ({ label: el.textContent ?? '', disabled: el.disabled }),
});
