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

// The OpenAI-compatible provider appends `/chat/completions` itself, so a base URL
// that already includes it (as MINDER_API_BASE_URL does) must be trimmed to the `/v1` root.
function normalizeBaseURL(url: string): string {
  return url.replace(/\/+chat\/completions\/?$/, '').replace(/\/+$/, '');
}

export function mountChatRoute(app: Express, deps: ChatDeps): void {
  app.post('/chat', async (req: Request, res: Response) => {
    const { messages, baseURL: bodyBaseURL, model: bodyModel } = (req.body ?? {}) as {
      messages?: unknown[];
      baseURL?: string;
      model?: string;
    };

    // Defaults come from the server env (MINDER_*). The bubble no longer sends these,
    // so the model id and endpoint stay out of the browser payload.
    const baseURL = bodyBaseURL ?? process.env.MINDER_API_BASE_URL;
    const model = bodyModel ?? process.env.MINDER_MODEL;

    // Only a browser-supplied baseURL is untrusted (SSRF / key-exfil). An env-configured
    // one is server-owned and bypasses the loopback allowlist.
    if (bodyBaseURL && !baseURLAllowed(bodyBaseURL)) {
      return res.status(400).json({ error: 'baseURL not allowed' });
    }
    if (!baseURL) {
      return res.status(500).json({ error: 'no baseURL configured (set MINDER_API_BASE_URL)' });
    }
    if (!model || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'model and messages required' });
    }

    const provider = createOpenAICompatible({
      name: 'byo',
      // MINDER_API_KEY overrides; OPENAI_API_KEY is the default; local endpoints ignore it.
      apiKey: process.env.MINDER_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.LLM_KEY ?? 'not-needed',
      baseURL: normalizeBaseURL(baseURL),
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
