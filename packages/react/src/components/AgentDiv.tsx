import type { ComponentPropsWithoutRef } from 'react';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';

export type AgentDivProps = AgentSharedProps & ComponentPropsWithoutRef<'div'>;

/** Agent-aware <div>: read-only context surface (no callable tool). */
export const AgentDiv = createAgentElement<'div', HTMLDivElement, void>({
  tag: 'div',
  contextOnly: true,
  readState: (el) => ({ text: el.textContent ?? '' }),
});
