// SpotlightController (T-K3/K4/K5) — drives driver.js from relay phase events.
// Dynamically imported by GrabMyCursorProvider ONLY when viz is on, so driver.js + CSS cost nothing
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
const CSS = `
.gmc-popover{--dc:#6ee7a0}
.gmc-popover .driver-popover-title{font-size:15px}
.gmc-popover .driver-popover-description code{background:#0e0e10;color:#9fe6b6;padding:1px 5px;border-radius:4px;font-size:12px;word-break:break-all}
.gmc-popover.gmc-pending{box-shadow:0 0 0 2px #e5b53b, 0 0 24px rgba(229,181,59,.5);animation:gmc-pulse 1.1s ease-in-out infinite}
.gmc-popover.gmc-pending .driver-popover-title{color:#e5b53b}
.gmc-popover.gmc-denied{box-shadow:0 0 0 2px #ff5b5b}
.gmc-popover.gmc-denied .driver-popover-title{color:#ff5b5b}
.gmc-popover.gmc-done{box-shadow:0 0 0 2px #6ee7a0}
.gmc-approve-link{display:inline-block;margin-top:8px;color:#8ab4ff;font-weight:600;text-decoration:none}
@keyframes gmc-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.25)}}
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
  const sel = `[data-grabmycursor-tool="${(window.CSS?.escape ?? ((x: string) => x))(name)}"]`;
  return document.querySelector(sel) ?? undefined;
}

function fidelity(preview: unknown): string {
  return `<code>${esc(JSON.stringify(preview ?? {}))}</code>`;
}

export function createSpotlight(approveUrl: string): Spotlight {
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

  let active: { id: string; name: string; preview: unknown } | undefined;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelClear = () => {
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = undefined;
  };
  const scheduleClear = (ms: number) => {
    cancelClear();
    clearTimer = setTimeout(() => d.destroy(), reduce ? 0 : ms);
  };

  function show(name: string, description: string, opts: { lock?: boolean; klass?: string } = {}) {
    cancelClear();
    d.setConfig({
      ...base,
      disableActiveInteraction: !!opts.lock,
      popoverClass: opts.klass ? `gmc-popover ${opts.klass}` : 'gmc-popover',
    });
    d.highlight({
      element: resolveEl(name),
      popover: {
        title: `Agent · ${name}`,
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
        case 'intent':
          if (!m.id || !m.name) break;
          active = { id: m.id, name: m.name, preview: m.argsPreview };
          show(m.name, `Agent wants to run this.<br>${fidelity(m.argsPreview)}`);
          say(`Agent requesting ${m.name}`);
          break;

        case 'gate':
          if (!active || m.id !== active.id) break;
          if (m.status === 'awaiting') {
            show(
              active.name,
              `⏳ Waiting for owner approval…<br>${fidelity(active.preview)}` +
                `<a class="gmc-approve-link" href="${approveUrl}" target="_blank" rel="noopener">→ open approval page</a>`,
              { lock: true, klass: 'gmc-pending' },
            );
            say(`${active.name} needs owner approval — waiting`);
          } else {
            say(`${active.name} allowed automatically`);
          }
          break;

        case 'decided':
          if (!active || m.id !== active.id) break;
          if (m.decision === 'denied') {
            show(active.name, `⛔ Denied by policy gate.`, { klass: 'gmc-denied' });
            say(`${active.name} denied by policy gate`);
            scheduleClear(1100);
            active = undefined;
          } else {
            show(active.name, `✅ Approved — running…`, { klass: 'gmc-done' });
            say(`${active.name} approved, running`);
          }
          break;

        case 'call':
          if (!active || m.id !== active.id) break;
          show(active.name, `⚙️ Running…`, { klass: 'gmc-done' });
          break;

        case 'done':
          if (!active || m.id !== active.id) break;
          show(active.name, `✅ Done.`, { klass: 'gmc-done' });
          say(`${active.name} done`);
          scheduleClear(700);
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
