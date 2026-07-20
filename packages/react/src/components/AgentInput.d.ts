import type { ComponentPropsWithoutRef } from 'react';
import { type AgentSharedProps } from './createAgentElement.js';
export type AgentInputProps = AgentSharedProps & ComponentPropsWithoutRef<'input'>;
/** Agent-aware <input>: the agent sets its value; the developer's onChange fires. */
export declare const AgentInput: import("react").ForwardRefExoticComponent<AgentSharedProps & Omit<import("react").DetailedHTMLProps<import("react").InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>, "ref"> & import("react").RefAttributes<HTMLInputElement>>;
