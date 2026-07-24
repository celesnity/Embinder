import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

export interface OperatorClientConfig { relayBaseUrl: string; operatorToken: string; }
export interface OperatorSnapshotTool { name: string; description?: string; inputSchema: unknown; context?: unknown; }

function url(cfg: OperatorClientConfig, path: string): string {
  return new URL(path, cfg.relayBaseUrl).toString();
}

async function request(cfg: OperatorClientConfig, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url(cfg, path), {
    ...init,
    headers: { 'x-embinder-operator-token': cfg.operatorToken, ...init.headers },
  });
  const body = await response.json() as { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `relay operator request failed (${response.status})`);
  return body;
}

export async function getOperatorSnapshot(cfg: OperatorClientConfig): Promise<OperatorSnapshotTool[]> {
  const body = await request(cfg, '/internal/operator/snapshot') as { tools?: unknown };
  if (!Array.isArray(body.tools)) throw new Error('todo_capability_unavailable: invalid operator snapshot');
  return body.tools as OperatorSnapshotTool[];
}

export async function callOperatorTool(cfg: OperatorClientConfig, args: { name: string; args: unknown; taskId: string }): Promise<unknown> {
  return request(cfg, '/internal/operator/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
}

function zodShape(schema: unknown): z.ZodRawShape {
  const object = schema as { type?: string; properties?: Record<string, { type?: string }>; required?: string[] };
  if (object.type !== 'object' || !object.properties) throw new Error('todo_capability_unavailable: invalid input schema');
  return Object.fromEntries(Object.entries(object.properties).map(([key, prop]) => {
    let value: z.ZodTypeAny = prop.type === 'number' || prop.type === 'integer' ? z.number()
      : prop.type === 'boolean' ? z.boolean() : prop.type === 'array' ? z.array(z.unknown()) : z.string();
    if (!object.required?.includes(key)) value = value.optional();
    return [key, value];
  }));
}

export function operatorTools(cfg: OperatorClientConfig, taskId: string, snapshot: OperatorSnapshotTool[]): ToolSet {
  return Object.fromEntries(snapshot.map((item) => [item.name, tool({
    description: item.description ?? `Operate Todo using ${item.name}.`,
    inputSchema: z.object(zodShape(item.inputSchema)),
    execute: async (args) => callOperatorTool(cfg, { name: item.name, args, taskId }),
  })]));
}
