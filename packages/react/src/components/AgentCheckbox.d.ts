import type { ComponentPropsWithoutRef } from 'react';
import { type AgentSharedProps } from './createAgentElement.js';
export type AgentCheckboxProps = AgentSharedProps & ComponentPropsWithoutRef<'input'>;
/** Agent-aware checkbox: the agent sets checked; the developer's onChange fires. */
export declare const AgentCheckbox: import("react").ForwardRefExoticComponent<AgentSharedProps & Omit<import("react").DetailedHTMLProps<import("react").InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>, "ref"> & import("react").RefAttributes<HTMLInputElement>>;
