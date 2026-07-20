import { createContext, useContext } from 'react';

export const ScopeContext = createContext<string | undefined>(undefined);

export function useAgentScopeId(): string | undefined {
  return useContext(ScopeContext);
}

export function makeScopeId(parentId: string | undefined, name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`AgentScope name must match ^[A-Za-z][A-Za-z0-9_]*$: ${name}`);
  }
  return parentId ? `${parentId}/${name}` : name;
}
