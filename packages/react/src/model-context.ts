// Feature-detect the WebMCP surface. Order matches @mcp-b/react-webmcp model-context.ts:13
// (document.modelContext preferred; navigator.modelContext deprecated in Chrome 150).

export interface ToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown; // JSON Schema
  annotations?: Record<string, unknown>;
  execute: (args: unknown) => unknown | Promise<unknown>;
}

export interface ModelContextSurface {
  registerTool(descriptor: ToolDescriptor, options?: { signal?: AbortSignal }): Promise<void> | void;
}

export function getModelContext(): ModelContextSurface | undefined {
  if (typeof window === 'undefined') return undefined;
  const doc = (window.document as unknown as { modelContext?: ModelContextSurface }).modelContext;
  const nav = (window.navigator as unknown as { modelContext?: ModelContextSurface }).modelContext;
  return doc ?? nav;
}
