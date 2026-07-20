import type { ComponentPropsWithoutRef } from 'react';
import { type AgentSharedProps } from './createAgentElement.js';
export type AgentDivProps = AgentSharedProps & ComponentPropsWithoutRef<'div'>;
/** Agent-aware <div>: read-only context surface (no callable tool). */
export declare const AgentDiv: import("react").ForwardRefExoticComponent<AgentSharedProps & Omit<import("react").DetailedHTMLProps<import("react").HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref"> & import("react").RefAttributes<HTMLDivElement>>;
