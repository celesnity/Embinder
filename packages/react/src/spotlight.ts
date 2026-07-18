// SpotlightController (T-K3/K4/K5) — drives driver.js from relay phase events.
// Dynamically imported by EmbinderProvider ONLY when viz is on, so driver.js + CSS cost nothing
// when the flag is off. AC-8. Never opens an approve/deny surface (AC-4) — display only.

import { driver, type Driver, type Config } from 'driver.js';
import 'driver.js/dist/driver.css';

export interface PhaseMessage {
  type: 'intent' | 'gate' | 'decided' | 'call' | 'done';
  id?: string;
  name?: string;
  argsPreview?: unknown;
  status?: 'auto' | 'awaiting';
  decision?: 'approved' | 'denied';
}

export interface Spotlight {
  handle(m: PhaseMessage): void;
  destroy(): void;
}

const STYLE_ID = 'gmc-spotlight-style';
// Clean, on-brand popover (navy panel + electric-blue accent, matching the chat bubble).
// No raw JSON, no snake_case tool ids, no emoji spinners — just a humanized action + state.
const CSS = `
.gmc-popover{background:linear-gradient(180deg,#101a2e,#0a1120);color:#e8eefb;
  border:1px solid rgba(90,150,255,.18);border-radius:14px;padding:14px 16px;max-width:280px;
  box-shadow:0 18px 44px -12px rgba(0,0,0,.7),0 0 0 1px rgba(90,150,255,.1);
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:box-shadow .25s ease,border-color .25s ease}
.gmc-popover .driver-popover-arrow{border-color:#0a1120!important}
.gmc-popover .driver-popover-title{font-size:14px;font-weight:700;letter-spacing:.2px;margin:0 0 5px;color:#eaf4ff;line-height:1.35}
.gmc-popover .driver-popover-description{font-size:12.5px;line-height:1.5;color:#9fb2d6;margin:0}
.gmc-popover .gmc-kicker{display:block;font-size:9.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:#5b76a6;margin-bottom:4px}

.gmc-popover.gmc-pending{border-color:rgba(240,180,41,.45);box-shadow:0 0 0 1px rgba(240,180,41,.45),0 18px 44px -12px rgba(0,0,0,.7);
  animation:gmc-pulse 1.7s ease-in-out infinite}
.gmc-popover.gmc-pending .driver-popover-title{color:#f7c948}
.gmc-popover.gmc-denied{border-color:rgba(255,107,107,.5);box-shadow:0 0 0 1px rgba(255,107,107,.4),0 18px 44px -12px rgba(0,0,0,.7)}
.gmc-popover.gmc-denied .driver-popover-title{color:#ff8a8a}
.gmc-popover.gmc-done{border-color:rgba(77,214,255,.45);box-shadow:0 0 0 1px rgba(77,214,255,.4),0 18px 44px -12px rgba(0,0,0,.7)}
.gmc-popover.gmc-done .driver-popover-title{color:#7fe3ff}

.gmc-approve-link{display:inline-block;margin-top:10px;color:#8fd3ff;font-weight:600;text-decoration:none;font-size:12.5px}
.gmc-approve-link:hover{color:#bfe6ff}
.gmc-popover .gmc-approve-row{display:flex;gap:8px;margin-top:12px}
.gmc-popover .gmc-decide{flex:1;font-size:12.5px;padding:8px 10px;border-radius:9px;cursor:pointer;border:1px solid transparent;font-weight:700;
  transition:transform .15s cubic-bezier(.34,1.56,.64,1),filter .15s ease}
.gmc-popover .gmc-decide:hover{filter:brightness(1.08);transform:translateY(-1px)}
.gmc-popover .gmc-decide:active{transform:translateY(0) scale(.98)}
.gmc-popover .gmc-approve{background:linear-gradient(145deg,#4dd6ff,#3b82f6);color:#04122c;box-shadow:0 4px 12px rgba(59,130,246,.4)}
.gmc-popover .gmc-deny{background:transparent;color:#ff9a9a;border-color:rgba(255,107,107,.35)}
@keyframes gmc-pulse{0%,100%{box-shadow:0 0 0 1px rgba(240,180,41,.45),0 18px 44px -12px rgba(0,0,0,.7)}
  50%{box-shadow:0 0 0 3px rgba(240,180,41,.22),0 18px 44px -12px rgba(0,0,0,.7)}}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
}

function resolveEl(name: string): Element | undefined {
  const sel = `[data-embinder-tool="${(window.CSS?.escape ?? ((x: string) => x))(name)}"]`;
  return document.querySelector(sel) ?? undefined;
}

// Turn a raw tool id (`ui_clear_board`, `restore_task`) into a friendly action phrase
// ("Clear board", "Restore task"). We never surface the snake_case id or its JSON args.
function humanize(name: string): string {
  const words = name.replace(/^ui_/, '').replace(/[_-]+/g, ' ').trim();
  return esc(words.charAt(0).toUpperCase() + words.slice(1));
}

export function createSpotlight(approveUrl: string, decideBase?: string): Spotlight {
  let approverToken: string | undefined;
  if (decideBase) {
    fetch(`${decideBase}/approver-token`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((j) => {
        approverToken = j?.token;
      })
      .catch(() => {});
  }
  injectStyle();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const base: Config = {
    animate: !reduce,
    overlayColor: 'rgba(2,6,23,0.6)',
    stagePadding: 6,
    stageRadius: 8,
    popoverClass: 'gmc-popover',
    disableActiveInteraction: false,
  };
  const d: Driver = driver(base);

  // a11y: spotlight is purely visual, so mirror every phase to a polite live region (T-K5).
  const live = document.createElement('div');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('role', 'status');
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
  document.body.appendChild(live);
  const say = (t: string) => {
    live.textContent = t;
  };

  // `gated` flips true only when a tool actually pauses for approval. The spotlight
  // is shown ONLY for gated tools — auto-passed read/write tools stay invisible.
  let active: { id: string; name: string; gated: boolean } | undefined;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelClear = () => {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = undefined;
  };
  const scheduleClear = (ms: number) => {
    cancelClear();
    clearTimer = setTimeout(() => d.destroy(), reduce ? 0 : ms);
  };

  async function postDecide(id: string, approve: boolean) {
    if (!decideBase || !approverToken) return;
    await fetch(`${decideBase}/api/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-approver-token': approverToken },
      body: JSON.stringify({ id, approve }),
    }).catch(() => {});
  }

  function show(
    name: string,
    description: string,
    opts: { lock?: boolean; klass?: string; decide?: string } = {},
  ) {
    cancelClear();
    const decideId = opts.decide;
    d.setConfig({
      ...base,
      disableActiveInteraction: !!opts.lock,
      popoverClass: opts.klass ? `gmc-popover ${opts.klass}` : 'gmc-popover',
      // Wire the Approve/Deny buttons embedded in the description (driver.js hides its own
      // footer when showButtons is empty, so we can't rely on footerButtons).
      onPopoverRender:
        decideId && approverToken
          ? (popover) => {
              const root = (popover.wrapper ?? popover.description) as HTMLElement | undefined;
              root?.querySelectorAll<HTMLButtonElement>('.gmc-decide').forEach((b) => {
                b.addEventListener('click', () =>
                  void postDecide(decideId, b.dataset.approve === '1'),
                );
              });
            }
          : undefined,
    });
    d.highlight({
      element: resolveEl(name),
      popover: {
        title: humanize(name),
        description,
        showButtons: [], // no decision buttons in the app tab (AC-4)
        side: 'top',
        align: 'center',
      },
    });
  }

  return {
    handle(m: PhaseMessage) {
      switch (m.type) {
        // Track the tool, but show NOTHING yet — we don't know if it needs approval
        // until the gate phase. Auto-passed tools never get a popover. (a11y-only.)
        case 'intent':
          if (!m.id || !m.name) break;
          active = { id: m.id, name: m.name, gated: false };
          say(`Agent requesting ${humanize(m.name)}`);
          break;

        case 'gate':
          if (!active || m.id !== active.id) break;
          if (m.status === 'awaiting') {
            active.gated = true; // this tool pauses → the ONLY case we surface a popover
            const inline = !!decideBase && !!approverToken;
            show(
              active.name,
              `<span class="gmc-kicker">Needs approval</span>Allow the agent to run this?` +
                (inline
                  ? `<div class="gmc-approve-row"><button class="gmc-decide gmc-approve" data-approve="1">Approve</button><button class="gmc-decide gmc-deny" data-approve="0">Deny</button></div>`
                  : `<a class="gmc-approve-link" href="${approveUrl}" target="_blank" rel="noopener">Open approval page →</a>`),
              { lock: true, klass: 'gmc-pending', decide: active.id },
            );
            say(`${humanize(active.name)} needs owner approval — waiting`);
          } else {
            // auto-passed: no visual, screen-reader only.
            say(`${humanize(active.name)} allowed automatically`);
          }
          break;

        // From here on, only gated tools ever had a popover — the rest stay silent.
        case 'decided':
          if (!active || m.id !== active.id) break;
          if (m.decision === 'denied') {
            if (active.gated) {
              show(active.name, `<span class="gmc-kicker">Blocked</span>Denied by the policy gate.`, { klass: 'gmc-denied' });
              scheduleClear(1100);
            }
            say(`${humanize(active.name)} denied by policy gate`);
            active = undefined;
          } else {
            if (active.gated) {
              show(active.name, `<span class="gmc-kicker">Approved</span>Running now.`, { klass: 'gmc-done' });
            }
            say(`${humanize(active.name)} approved, running`);
          }
          break;

        case 'call':
          if (!active || m.id !== active.id) break;
          if (active.gated) show(active.name, `<span class="gmc-kicker">Running</span>Applying the change.`, { klass: 'gmc-done' });
          break;

        case 'done':
          if (!active || m.id !== active.id) break;
          if (active.gated) {
            show(active.name, `<span class="gmc-kicker">Done</span>Change applied.`, { klass: 'gmc-done' });
            scheduleClear(700);
          }
          say(`${humanize(active.name)} done`);
          active = undefined;
          break;
      }
    },
    destroy() {
      cancelClear();
      d.destroy();
      live.remove();
    },
  };
}
