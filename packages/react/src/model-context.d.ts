export interface ToolDescriptor {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    annotations?: Record<string, unknown>;
    execute: (args: unknown) => unknown | Promise<unknown>;
}
export interface ModelContextSurface {
    registerTool(descriptor: ToolDescriptor, options?: {
        signal?: AbortSignal;
    }): Promise<void> | void;
}
export declare function getModelContext(): ModelContextSurface | undefined;
