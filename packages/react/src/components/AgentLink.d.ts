import type { ComponentPropsWithoutRef } from 'react';
import { type AgentSharedProps } from './createAgentElement.js';
export type AgentLinkProps = AgentSharedProps & ComponentPropsWithoutRef<'a'>;
/** Agent-aware <a>: the agent activates it with a native click. */
export declare const AgentLink: import("react").ForwardRefExoticComponent<AgentSharedProps & Omit<import("react").DetailedHTMLProps<import("react").AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>, "ref"> & import("react").RefAttributes<HTMLAnchorElement>>;
