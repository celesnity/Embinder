import type { ComponentPropsWithoutRef } from 'react';
import { type AgentSharedProps } from './createAgentElement.js';
export type AgentSelectProps = AgentSharedProps & ComponentPropsWithoutRef<'select'>;
/** Agent-aware <select>: the agent picks an option value; unknown values no-op. */
export declare const AgentSelect: import("react").ForwardRefExoticComponent<AgentSharedProps & Omit<import("react").DetailedHTMLProps<import("react").SelectHTMLAttributes<HTMLSelectElement>, HTMLSelectElement>, "ref"> & import("react").RefAttributes<HTMLSelectElement>>;
