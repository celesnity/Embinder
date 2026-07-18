// The resident agent bubble (default-mounted by EmbinderProvider, D-9).
// LLM config comes from the relay's /chat-config (env, beside the key) — app code
// carries none. Unconfigured relay => a "connect a model" hint instead of a composer.
// Session memory only (refresh clears it).
import { useEffect, useMemo, useState } from 'react';
import { AssistantRuntimeProvider, AssistantModalPrimitive, ThreadPrimitive, ComposerPrimitive, MessagePrimitive } from '@assistant-ui/react';
import { useChatRuntime, AssistantChatTransport } from '@assistant-ui/react-ai-sdk';
import { ROBOT_HEAD } from './robot-head.js';

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

// ---------------------------------------------------------------------------
// Injected styles. Prefixed emb-cb-* so they never collide with the host app.
// Palette: navy #0a1120/#101a2e, electric blue #3b82f6, cyan #4dd6ff, white text.
// All motion sits behind prefers-reduced-motion: no-preference.
// ---------------------------------------------------------------------------
const STYLE_ID = 'emb-cb-style';
const CSS = `
.emb-cb-fab{position:relative;width:58px;height:58px;border-radius:50%;border:1px solid rgba(120,180,255,.35);cursor:pointer;
  background:radial-gradient(120% 120% at 50% 20%,#1c2c4c 0%,#0e1a30 70%);
  overflow:hidden;isolation:isolate;
  box-shadow:0 8px 26px rgba(37,99,235,.45),0 2px 6px rgba(0,0,0,.4);
  transition:transform .28s cubic-bezier(.34,1.56,.64,1),box-shadow .28s ease}
.emb-cb-fab:hover{transform:scale(1.06);box-shadow:0 12px 34px rgba(59,130,246,.62),0 3px 8px rgba(0,0,0,.45)}
.emb-cb-fab:active{transform:scale(.94)}
.emb-cb-fab:focus-visible{outline:2px solid #4dd6ff;outline-offset:3px}
/* breathing cyan halo */
.emb-cb-fab::before{content:'';position:absolute;inset:-3px;border-radius:50%;z-index:-1;
  background:radial-gradient(closest-side,rgba(77,214,255,.6),transparent);opacity:0}
.emb-cb-ico{position:absolute;inset:0;display:grid;place-items:center;
  transition:transform .32s cubic-bezier(.34,1.56,.64,1),opacity .22s ease}
.emb-cb-ico-open{opacity:1;transform:rotate(0) scale(1)}
.emb-cb-robot{width:40px;height:40px;background:center/contain no-repeat url('${ROBOT_HEAD}');
  filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))}
.emb-cb-ico-close{opacity:0;transform:rotate(-90deg) scale(.4);color:#dbeafe;font-size:22px;font-weight:400}
.emb-cb-fab[data-state=open] .emb-cb-ico-open{opacity:0;transform:rotate(90deg) scale(.4)}
.emb-cb-fab[data-state=open] .emb-cb-ico-close{opacity:1;transform:rotate(0) scale(1)}

.emb-cb-panel{width:380px;height:520px;display:flex;flex-direction:column;overflow:hidden;
  transform-origin:var(--radix-popover-content-transform-origin);
  color:#e8eefb;border-radius:18px;
  background:linear-gradient(180deg,#101a2e 0%,#0a1120 100%);
  border:1px solid transparent;background-clip:padding-box;
  box-shadow:0 24px 60px -12px rgba(0,0,0,.7),0 0 0 1px rgba(90,150,255,.12),inset 0 1px 0 rgba(120,180,255,.08);
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
/* gradient hairline ring in brand blue/cyan */
.emb-cb-panel::before{content:'';position:absolute;inset:0;border-radius:18px;padding:1px;pointer-events:none;
  background:linear-gradient(160deg,rgba(77,214,255,.6),rgba(59,130,246,.25) 40%,transparent 72%);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude}

.emb-cb-head{position:relative;display:flex;align-items:center;gap:9px;padding:11px 13px;
  border-bottom:1px solid rgba(90,150,255,.14);
  background:linear-gradient(180deg,rgba(59,130,246,.10),transparent)}
.emb-cb-avatar{position:relative;width:26px;height:26px;border-radius:50%;flex:none;
  background:radial-gradient(120% 120% at 50% 20%,#1c2c4c,#0e1a30) center/cover;
  border:1px solid rgba(120,180,255,.3)}
.emb-cb-avatar::after{content:'';position:absolute;inset:2px;background:center/contain no-repeat url('${ROBOT_HEAD}')}
.emb-cb-dot{position:absolute;right:-1px;bottom:-1px;width:8px;height:8px;border-radius:50%;background:#4dd6ff;
  border:2px solid #0d1526;box-shadow:0 0 0 0 rgba(77,214,255,.7)}
.emb-cb-title{font-size:13px;font-weight:700;letter-spacing:.2px;
  background:linear-gradient(90deg,#eaf4ff,#8fd3ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.emb-cb-sub{margin-left:auto;font-size:10px;color:#5b76a6;letter-spacing:.3px;text-transform:uppercase}

.emb-cb-view{flex:1;min-height:0;overflow-y:auto;padding:8px 6px;scrollbar-width:thin;scrollbar-color:#26334d transparent}
.emb-cb-view::-webkit-scrollbar{width:8px}
.emb-cb-view::-webkit-scrollbar-thumb{background:#26334d;border-radius:8px;border:2px solid transparent;background-clip:content-box}

.emb-cb-msg{padding:8px 12px;margin:6px 8px;font-size:14px;line-height:1.5;border-radius:12px;
  background:rgba(120,170,255,.06);border:1px solid rgba(120,170,255,.1);
  box-shadow:0 1px 2px rgba(0,0,0,.25);word-break:break-word}

.emb-cb-empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  text-align:center;padding:24px;color:#8ea3c9}
.emb-cb-empty-glyph{width:52px;height:52px;border-radius:16px;position:relative;
  background:radial-gradient(120% 120% at 50% 20%,#1c2c4c,#0e1a30);border:1px solid rgba(120,180,255,.28);
  box-shadow:0 8px 22px rgba(37,99,235,.4)}
.emb-cb-empty-glyph::after{content:'';position:absolute;inset:7px;background:center/contain no-repeat url('${ROBOT_HEAD}')}
.emb-cb-empty-t{font-size:14px;font-weight:600;color:#dbe6fb}
.emb-cb-empty-s{font-size:12px;color:#6f83ab;max-width:230px;line-height:1.55}

.emb-cb-typing{display:flex;align-items:center;gap:5px;padding:10px 16px;margin:6px 8px}
.emb-cb-typing i{width:6px;height:6px;border-radius:50%;background:#4dd6ff;display:inline-block;opacity:.4}

.emb-cb-composer{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(90,150,255,.14);
  background:linear-gradient(180deg,rgba(120,170,255,.04),transparent)}
.emb-cb-input{flex:1;background:#0a1120;color:#e8eefb;border:1px solid rgba(120,170,255,.16);
  border-radius:10px;padding:9px 11px;font-size:13px;outline:none;
  transition:border-color .2s ease,box-shadow .2s ease}
.emb-cb-input::placeholder{color:#566d99}
.emb-cb-input:focus{border-color:rgba(77,214,255,.65);box-shadow:0 0 0 3px rgba(59,130,246,.2)}
.emb-cb-send{background:linear-gradient(145deg,#4dd6ff,#3b82f6);color:#04122c;border:none;border-radius:10px;
  padding:9px 15px;font-weight:700;font-size:13px;cursor:pointer;
  box-shadow:0 4px 14px rgba(59,130,246,.42);
  transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .2s ease,filter .2s ease}
.emb-cb-send:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(59,130,246,.6);filter:brightness(1.06)}
.emb-cb-send:active{transform:translateY(0) scale(.97)}

@media (prefers-reduced-motion: no-preference){
  .emb-cb-fab::before{animation:emb-cb-halo 2.6s ease-in-out infinite}
  .emb-cb-dot{animation:emb-cb-pulse 2s ease-in-out infinite}
  .emb-cb-panel[data-state=open]{animation:emb-cb-in .34s cubic-bezier(.32,.72,0,1)}
  .emb-cb-panel[data-state=closed]{animation:emb-cb-out .2s ease-in forwards}
  .emb-cb-msg{animation:emb-cb-msg-in .34s cubic-bezier(.22,1,.36,1)}
  .emb-cb-empty-glyph{animation:emb-cb-float 3.4s ease-in-out infinite}
  .emb-cb-typing i{animation:emb-cb-bounce 1.1s ease-in-out infinite}
  .emb-cb-typing i:nth-child(2){animation-delay:.16s}
  .emb-cb-typing i:nth-child(3){animation-delay:.32s}
}
@keyframes emb-cb-halo{0%,100%{opacity:0;transform:scale(1)}50%{opacity:.85;transform:scale(1.12)}}
@keyframes emb-cb-pulse{0%,100%{box-shadow:0 0 0 0 rgba(77,214,255,.6)}50%{box-shadow:0 0 0 5px rgba(77,214,255,0)}}
@keyframes emb-cb-in{from{opacity:0;transform:translateY(10px) scale(.92)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes emb-cb-out{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(8px) scale(.94)}}
@keyframes emb-cb-msg-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes emb-cb-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes emb-cb-bounce{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-5px)}}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

// Trigger button. asChild forwards Radix's data-state so the robot morphs to a close icon.
const FabButton = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<'button'> & { 'data-state'?: string }
>((props, ref) => (
  <button ref={ref} className="emb-cb-fab" aria-label="Open chat" {...props}>
    <span className="emb-cb-ico emb-cb-ico-open"><span className="emb-cb-robot" aria-hidden /></span>
    <span className="emb-cb-ico emb-cb-ico-close" aria-hidden>✕</span>
  </button>
));
FabButton.displayName = 'FabButton';

function Message() {
  return (
    <MessagePrimitive.Root className="emb-cb-msg">
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

  const transport = useMemo(() => {
    // By default the relay picks baseURL/model from MINDER_API_BASE_URL / MINDER_MODEL,
    // so we send neither. Only forward an explicit per-instance override if one was given.
    const body: Record<string, string> = {};
    if (cfg.baseURL) body.baseURL = cfg.baseURL;
    if (cfg.model) body.model = cfg.model;
    return new AssistantChatTransport({ api, body });
  }, [api, cfg.baseURL, cfg.model]);
  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantModalPrimitive.Root>
        <AssistantModalPrimitive.Anchor style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}>
          <AssistantModalPrimitive.Trigger asChild>
            <FabButton />
          </AssistantModalPrimitive.Trigger>
        </AssistantModalPrimitive.Anchor>

        <AssistantModalPrimitive.Content
          side="top"
          align="end"
          sideOffset={16}
          className="emb-cb-panel"
          style={{ position: 'relative', zIndex: 1000 }}
        >
          <ThreadPrimitive.Root style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ThreadPrimitive.Viewport className="emb-cb-view">
              <ThreadPrimitive.If empty>
                <div className="emb-cb-empty">
                  <div className="emb-cb-empty-glyph" aria-hidden />
                  <div className="emb-cb-empty-t">How can I help?</div>
                  <div className="emb-cb-empty-s">Ask me to do something. Anything I run still passes through the approval gate.</div>
                </div>
              </ThreadPrimitive.If>

              <ThreadPrimitive.Messages components={{ Message }} />

              <ThreadPrimitive.If running>
                <div className="emb-cb-typing" aria-label="Assistant is typing">
                  <i /><i /><i />
                </div>
              </ThreadPrimitive.If>
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
