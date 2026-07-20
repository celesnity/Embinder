import type { ComponentPropsWithoutRef } from 'react';
import { type AgentSharedProps } from './createAgentElement.js';
export type AgentRadioGroupProps = AgentSharedProps & ComponentPropsWithoutRef<'div'>;
/** Agent-aware radio group: one { value } tool that checks the matching child radio. */
export declare const AgentRadioGroup: import("react").ForwardRefExoticComponent<AgentSharedProps & Omit<import("react").DetailedHTMLProps<import("react").HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "ref"> & import("react").RefAttributes<HTMLDivElement>>;
