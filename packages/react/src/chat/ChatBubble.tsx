// The resident agent bubble (default-mounted by EmbinderProvider, D-9).
// LLM config comes from the relay's /chat-config (env, beside the key) — app code
// carries none. Unconfigured relay => a "connect a model" hint instead of a composer.
// Session memory only (refresh clears it).
import { useEffect, useMemo, useState } from 'react';
import { AssistantRuntimeProvider, AssistantModalPrimitive, ThreadPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react';
import { useChatRuntime, AssistantChatTransport } from '@assistant-ui/react-ai-sdk';

export interface ChatBubbleConfig {
  /** relay chat endpoint. Default `${configBase}/chat`. */
  api?: string;
  /** Override the relay-provided OpenAI-compatible base URL (rarely needed). */
  baseURL?: string;
  /** Override the relay-provided model id (rarely needed). */
  model?: string;
}

interface ChatBubbleProps extends ChatBubbleConfig {
  /** Relay http base, injected by EmbinderProvider (e.g. http://127.0.0.1:7331). */
  configBase?: string;
}

function Message() {
  return (
    <MessagePrimitive.Root style={{ padding: '6px 10px', fontSize: 14 }}>
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

export function ChatBubble(cfg: ChatBubbleProps = {}) {
  const base = cfg.configBase ?? 'http://127.0.0.1:7331';
  const api = cfg.api ?? `${base}/chat`;

  // D-9: fetch relay-owned config unless the app explicitly overrode it.
  const [fetched, setFetched] = useState<{ baseURL: string | null; model: string | null } | null>(null);
  useEffect(() => {
    if (cfg.baseURL && cfg.model) return;
    let cancelled = false;
    fetch(`${base}/chat-config`)
      .then((r) => r.json())
      .then((c) => !cancelled && setFetched(c))
      .catch(() => !cancelled && setFetched({ baseURL: null, model: null }));
    return () => {
      cancelled = true;
    };
  }, [base, cfg.baseURL, cfg.model]);

  const baseURL = cfg.baseURL ?? fetched?.baseURL ?? undefined;
  const model = cfg.model ?? fetched?.model ?? undefined;
  const ready = Boolean(baseURL && model);

  const transport = useMemo(
    () => new AssistantChatTransport({ api, body: { baseURL, model } }),
    [api, baseURL, model],
  );
  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantModalPrimitive.Root>
        <AssistantModalPrimitive.Anchor style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}>
          <AssistantModalPrimitive.Trigger
            style={{ width: 52, height: 52, borderRadius: '50%', background: '#6ee7a0', color: '#04140a', border: 'none', fontSize: 22, cursor: 'pointer', boxShadow: '0 6px 24px rgba(0,0,0,.35)' }}
            aria-label="Open chat"
          >
            ✦
          </AssistantModalPrimitive.Trigger>
        </AssistantModalPrimitive.Anchor>
        <AssistantModalPrimitive.Content
          style={{ position: 'fixed', bottom: 84, right: 20, width: 360, height: 480, background: '#141416', color: '#eaeaea', border: '1px solid #2a2a2e', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 1000 }}
        >
          <ThreadPrimitive.Root style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ThreadPrimitive.Viewport style={{ flex: 1, overflowY: 'auto' }}>
              <ThreadPrimitive.Messages components={{ Message }} />
            </ThreadPrimitive.Viewport>
            {ready ? (
              <ComposerPrimitive.Root style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #2a2a2e' }}>
                <ComposerPrimitive.Input
                  placeholder="Ask the agent…"
                  style={{ flex: 1, background: '#0e0e10', color: '#eaeaea', border: '1px solid #2a2a2e', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
                />
                <ComposerPrimitive.Send
                  style={{ background: '#6ee7a0', color: '#04140a', border: 'none', borderRadius: 6, padding: '6px 12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Send
                </ComposerPrimitive.Send>
              </ComposerPrimitive.Root>
            ) : (
              <div style={{ padding: '10px 12px', borderTop: '1px solid #2a2a2e', fontSize: 12, color: '#9aa0a6' }}>
                Connect a model: set <code>LLM_BASE_URL</code> and <code>LLM_MODEL</code> in the
                relay&rsquo;s environment, then restart it.
              </div>
            )}
          </ThreadPrimitive.Root>
        </AssistantModalPrimitive.Content>
      </AssistantModalPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
