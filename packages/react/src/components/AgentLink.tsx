import type { ComponentPropsWithoutRef } from 'react';
import { createAgentElement, type AgentSharedProps } from './createAgentElement.js';

export type AgentLinkProps = AgentSharedProps & ComponentPropsWithoutRef<'a'>;

/** Agent-aware <a>: the agent activates it with a native click. */
export const AgentLink = createAgentElement<'a', HTMLAnchorElement, void>({
  tag: 'a',
  execute: (el) => el.click(),
  readState: (el) => ({ href: el.getAttribute('href') ?? '', text: el.textContent ?? '' }),
});
