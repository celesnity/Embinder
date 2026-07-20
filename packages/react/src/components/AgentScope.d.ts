import { type HTMLAttributes, type ReactNode } from 'react';
export interface AgentScopeProps extends HTMLAttributes<HTMLDivElement> {
    name: string;
    summary: () => unknown;
    children: ReactNode;
}
export declare function AgentScope({ name, summary, children, ...native }: AgentScopeProps): import("react").JSX.Element;
