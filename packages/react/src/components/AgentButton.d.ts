import type { ComponentPropsWithoutRef } from 'react';
import { type AgentSharedProps } from './createAgentElement.js';
export type AgentButtonProps = AgentSharedProps & ComponentPropsWithoutRef<'button'>;
/** Agent-aware <button>: the agent clicks it; no handler needed. */
export declare const AgentButton: import("react").ForwardRefExoticComponent<AgentSharedProps & Omit<import("react").DetailedHTMLProps<import("react").ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>, "ref"> & import("react").RefAttributes<HTMLButtonElement>>;
