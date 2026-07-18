// @minder/react — app-side SDK.
// Reuse WebMCP ergonomics (useWebMCP) + a relay-backed document.modelContext shim.

export { MinderProvider } from './provider.js';
export type { MinderProviderProps } from './provider.js';

// T-K1: spread onto the element that owns a tool, so the spotlight can anchor to it.
export function minderAnchor(name: string): { 'data-minder-tool': string } {
  return { 'data-minder-tool': name };
}
export { getModelContext } from './model-context.js';
export type { ToolDescriptor, ModelContextSurface } from './model-context.js';

// Re-export the WebMCP hook so apps declare tools with one import (T-B2).
export { useWebMCP } from '@mcp-b/react-webmcp';
