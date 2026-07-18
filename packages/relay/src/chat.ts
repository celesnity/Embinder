// T-CB3 — relay-hosted LLM loop (Arch A). Key stays in env; baseURL/model come per-request.
// Tools are the SAME registry the MCP path uses; each execute routes through runGatedCall (one gate).
import type { Express, Request, Response } from 'express';
import { z, type ZodRawShape } from 'zod';
import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  toUIMessageStream,
} from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ChatDeps {
  toolRegistry: Map<string, { config: { description?: string; inputSchema?: ZodRawShape }; destructive: boolean }>;
  runGatedCall: (
    name: string,
    args: unknown,
    destructive: boolean,
    session: string | undefined,
    signal: AbortSignal,
    keepAlive?: () => void,
  ) => Promise<CallToolResult>;
}

// SSRF / key-exfil guard: the browser can set baseURL, so its host must be allowlisted,
// else an attacker could point the relay's key at their own endpoint. (default: loopback)
function allowlist(): string[] {
  return (process.env.LLM_BASE_URL_ALLOWLIST ?? '127.0.0.1,localhost')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function baseURLAllowed(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    return allowlist().includes(new URL(baseURL).hostname);
  } catch {
    return false;
  }
}

export function mountChatRoute(app: Express, deps: ChatDeps): void {
  app.post('/chat', async (req: Request, res: Response) => {
    const { messages, baseURL, model } = (req.body ?? {}) as {
      messages?: unknown[];
      baseURL?: string;
      model?: string;
    };
    if (!baseURLAllowed(baseURL)) {
      return res.status(400).json({ error: 'baseURL not allowed' });
    }
    if (!model || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'model and messages required' });
    }

    const provider = createOpenAICompatible({
      name: 'byo',
      apiKey: process.env.LLM_KEY ?? 'not-needed', // local endpoints (LM Studio) ignore it
      baseURL: baseURL!,
    });

    // Abort the gate/stream if the browser disconnects.
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const session = `chat:${randomUUID()}`;

    // Build AI SDK tools from the SAME registry. execute = the SAME gate. (one gate)
    const tools = Object.fromEntries(
      [...deps.toolRegistry].map(([name, def]) => [
        name,
        tool({
          description: def.config.description ?? name,
          inputSchema: z.object(def.config.inputSchema ?? ({} as ZodRawShape)),
          execute: async (args: unknown) => {
            const result = await deps.runGatedCall(
              name,
              args,
              def.destructive,
              session,
              controller.signal,
            );
            // runGatedCall returns a CallToolResult wrapping JSON text; hand the LLM the value.
            const c = result.content[0] as { type: 'text'; text: string };
            return JSON.parse(c.text);
          },
        }),
      ]),
    );

    const result = streamText({
      model: provider(model!),
      messages: await convertToModelMessages(messages as never),
      tools,
      stopWhen: stepCountIs(6),
    });

    pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({ stream: result.stream }),
    });
  });
}
