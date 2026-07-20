import type { ComponentPropsWithoutRef } from 'react';
import { type AgentSharedProps } from './createAgentElement.js';
export type AgentToggleProps = AgentSharedProps & ComponentPropsWithoutRef<'button'>;
/**
 * Agent-aware switch (`<button role="switch">`). The agent sets `{ on }` by
 * CLICKING the button (agent action == user action). CONTRACT: the developer must
 * reflect the on/off state in `aria-checked` (flip it in their own onClick), the
 * same as a controlled ARIA switch. `readState` and the click-idempotency both read
 * `aria-checked`; if it is never wired, the toggle reports `on:false` and re-clicks.
 */
export declare const AgentToggle: import("react").ForwardRefExoticComponent<AgentSharedProps & Omit<import("react").DetailedHTMLProps<import("react").ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>, "ref"> & import("react").RefAttributes<HTMLButtonElement>>;
