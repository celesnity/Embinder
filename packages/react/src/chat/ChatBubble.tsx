// T-CB4 — in-app chat bubble. Binds assistant-ui to the relay /chat route (Arch A).
// Not a product: one more agent through the same gate. Session memory only (refresh clears it).
import { useMemo, useState } from 'react';
import { AssistantRuntimeProvider, AssistantModalPrimitive, ThreadPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react';
import { useChatRuntime, AssistantChatTransport } from '@assistant-ui/react-ai-sdk';

export interface ChatBubbleConfig {
  /** relay chat endpoint. Default http://127.0.0.1:7331/chat */
  api?: string;
  /** OpenAI-compatible base URL sent to the relay. Default LM Studio. */
  baseURL?: string;
  /** model id sent to the relay. */
  model?: string;
}

const DEFAULTS = {
  api: 'http://127.0.0.1:7331/chat',
  baseURL: 'http://127.0.0.1:1234/v1', // LM Studio preset
  model: 'qwen2.5-7b-instruct',
};

function Message() {
  return (
    <MessagePrimitive.Root style={{ padding: '6px 10px', fontSize: 14 }}>
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

export function ChatBubble(cfg: ChatBubbleConfig = {}) {
  const api = cfg.api ?? DEFAULTS.api;
  const [baseURL, setBaseURL] = useState(cfg.baseURL ?? DEFAULTS.baseURL);
  const [model, setModel] = useState(cfg.model ?? DEFAULTS.model);

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
          <div style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid #2a2a2e' }}>
            <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="baseURL" style={{ flex: 2, background: '#0e0e10', color: '#9fe6b6', border: '1px solid #2a2a2e', borderRadius: 6, padding: '4px 6px', fontSize: 11 }} />
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model" style={{ flex: 1, background: '#0e0e10', color: '#9fe6b6', border: '1px solid #2a2a2e', borderRadius: 6, padding: '4px 6px', fontSize: 11 }} />
          </div>
          <ThreadPrimitive.Root style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ThreadPrimitive.Viewport style={{ flex: 1, overflowY: 'auto' }}>
              <ThreadPrimitive.Messages components={{ Message }} />
            </ThreadPrimitive.Viewport>
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
          </ThreadPrimitive.Root>
        </AssistantModalPrimitive.Content>
      </AssistantModalPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
