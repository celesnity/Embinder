import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { ScopeContext, makeScopeId, useAgentScopeId } from '../scope-context.js';
import { registerEmbinderScope, sendEmbinderScopeContext, unregisterEmbinderScope } from '../provider.js';

const DEBOUNCE = 150;
const MAX_BYTES = 16 * 1024;

export interface AgentScopeProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  summary: () => unknown;
  children: ReactNode;
}

export function AgentScope({ name, summary, children, ...native }: AgentScopeProps) {
  const parentId = useAgentScopeId();
  const id = makeScopeId(parentId, name);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const last = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    registerEmbinderScope({ id, parentId, name });
    return () => unregisterEmbinderScope(id);
  }, [id, parentId, name]);
  useEffect(() => {
    let json = JSON.stringify(summaryRef.current());
    if (json !== undefined && json.length > MAX_BYTES) json = JSON.stringify('[truncated]');
    if (json === last.current) return;
    last.current = json;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => sendEmbinderScopeContext(id, JSON.parse(json)), DEBOUNCE);
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return <ScopeContext.Provider value={id}><div {...native} data-embinder-scope={id}>{children}</div></ScopeContext.Provider>;
}
