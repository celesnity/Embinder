// @minder/react — app-side SDK.
// Reuse WebMCP ergonomics (useWebMCP) + a relay-backed document.modelContext shim.

export { MinderProvider } from './provider.js';
export type { MinderProviderProps } from './provider.js';
export { getModelContext } from './model-context.js';
export type { ToolDescriptor, ModelContextSurface } from './model-context.js';

// Re-export the WebMCP hook so apps declare tools with one import (T-B2).
export { useWebMCP } from '@mcp-b/react-webmcp';
