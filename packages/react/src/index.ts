// @embinder/react — app-side SDK.
// Reuse WebMCP ergonomics (useWebMCP) + a relay-backed document.modelContext shim.

export { EmbinderProvider } from './provider.js';
export type { EmbinderProviderProps } from './provider.js';

// T-K1: spread onto the element that owns a tool, so the spotlight can anchor to it.
export function grabAnchor(name: string): { 'data-embinder-tool': string } {
  return { 'data-embinder-tool': name };
}
export { getModelContext } from './model-context.js';
export type { ToolDescriptor, ModelContextSurface } from './model-context.js';

// Re-export the WebMCP hook so apps declare tools with one import (T-B2).
export { useWebMCP } from '@mcp-b/react-webmcp';

// Agent-driven UI action hooks (declare participants; the SDK generates the tools).
export * from './actions/index.js';

export type { ChatBubbleConfig } from './chat/ChatBubble.js';
