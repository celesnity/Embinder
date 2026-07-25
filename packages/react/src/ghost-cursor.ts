// GhostCursor (T-K6) — a floating robot mascot that represents the AGENT's own cursor.
// A separate, pointer-events:none overlay, independent of the user's real system cursor and
// always on screen. When idle it slowly WANDERS along a smooth curved path (steering toward
// drifting random goals) and leaves a fading cyan spaceship trail. When the agent acts it
// glides to the targeted element, shows a typing bubble, then resumes wandering. It also
// reacts to the user's real cursor: fades when hovered, and pops a random-word speech bubble
// plus a spark burst when clicked. Dynamically imported ONLY when viz is on.
//
// Motion model: the OUTER element owns screen position. Idle uses a requestAnimationFrame loop
// that integrates a curved path with transition:none (crisp per-frame). Agent glides switch to
// the CSS transition. The INNER body owns the idle float; the innermost img owns the poke pop —
// separate elements so glide, float and poke never clobber each other's transform.

import type { PhaseMessage } from './spotlight.js';
import { setGhostController } from './actions/ghost-bridge.js';
import { resolveAgentTarget } from './resolve-target.js';
import {
  createEmbinderMotionPolicy,
  type EmbinderMotionPolicy,
} from './motion-policy.js';

export interface GhostCursor {
  handle(m: PhaseMessage): void;
  destroy(): void;
}

const IMG = 'data:image/png;base64,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';
const SIZE = 72;
const HOTX = 0.2554;
const HOTY = 0.3494;
const MARGIN = 22;   // keep this far from the viewport edges while wandering
const SPEED = 34;    // px/sec — slow drift
const TURN = 1.5;    // rad/sec — max steering rate (lower = lazier, wider curves)

// Short English words the mascot blurts out in a speech bubble when the user clicks it.
const SAYINGS = [
  'Hi!', 'Hello', 'Hey there', 'Beep boop', 'Boop!', 'Ready', 'On it', 'Yes?',
  'At your service', 'Nice', "Let's go", 'Whee!', 'Howdy', 'Ping', 'Zoom',
  'Aye aye', 'Working', 'Sup', 'Poke!', 'Gotcha', 'Okay', 'Hehe', 'Wheee',
];

const STYLE_ID = 'gmc-ghost-style';
const CSS = `
.gmc-ghost{position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;z-index:2147483646;
  pointer-events:none;opacity:0;transform:translate(${MARGIN}px,${MARGIN}px);
  transition:transform .55s cubic-bezier(.22,1,.36,1),opacity .28s ease;will-change:transform,opacity}
.gmc-ghost.is-on{opacity:1}
/* fade out of the way when the user's real cursor is over the mascot */
.gmc-ghost.is-on.is-shy{opacity:.28}
/* banking layer — the mascot leans into its turns; isolated so it never fights float/poke */
.gmc-ghost-tilt{width:100%;height:100%;transform:rotate(0deg);transform-origin:50% 62%;
  transition:transform .25s ease-out;will-change:transform}
.gmc-ghost-body{position:relative;width:100%;height:100%;
  filter:drop-shadow(0 4px 7px rgba(0,0,0,.4));will-change:transform,filter}
.gmc-ghost-img{width:100%;height:100%;background:center/contain no-repeat url('${IMG}')}
.gmc-ghost.is-pending .gmc-ghost-body{filter:drop-shadow(0 0 14px rgba(229,181,59,.95)) drop-shadow(0 4px 7px rgba(0,0,0,.4))}
.gmc-ghost.is-denied .gmc-ghost-body{filter:drop-shadow(0 0 13px rgba(255,91,91,.9)) drop-shadow(0 4px 7px rgba(0,0,0,.4))}

/* spaceship trail — layered glowing comet puffs (bright core + soft blue halo), hue drifts
   cyan -> blue and each puff tapers as it ages, so the tail reads as a jet stream */
.gmc-ghost-trail{position:fixed;left:0;top:0;border-radius:50%;pointer-events:none;z-index:2147483645;
  background:radial-gradient(circle,rgba(220,248,255,.98),var(--c,#4dd6ff) 42%,rgba(77,214,255,0) 72%);
  box-shadow:0 0 10px 1px var(--c,#4dd6ff);will-change:transform,opacity}
/* sparkle star occasionally flicked off the jet */
.gmc-ghost-star{position:fixed;left:0;top:0;width:3px;height:3px;border-radius:50%;pointer-events:none;
  z-index:2147483645;background:#eaffff;box-shadow:0 0 7px 2px rgba(150,230,255,.95);will-change:transform,opacity}

/* typing / working bubble, anchored to the robot's upper-right */
.gmc-ghost-type{position:absolute;top:-4px;left:calc(100% - 16px);display:flex;gap:4px;align-items:center;
  padding:6px 9px;border-radius:11px 11px 11px 3px;background:#141416;border:1px solid rgba(255,255,255,.1);
  box-shadow:0 6px 16px rgba(0,0,0,.45);opacity:0;transform:translateY(4px) scale(.8);transform-origin:bottom left;
  transition:opacity .2s ease,transform .25s cubic-bezier(.34,1.56,.64,1)}
.gmc-ghost.is-working .gmc-ghost-type{opacity:1;transform:translateY(0) scale(1)}
.gmc-ghost-type i{width:5px;height:5px;border-radius:50%;background:#4dd6ff;opacity:.4}

/* speech bubble on the mascot's head — a random word on click */
.gmc-ghost-say{position:absolute;left:32px;bottom:calc(100% + 6px);
  padding:5px 10px;border-radius:12px;white-space:nowrap;font:600 12px/1 system-ui,-apple-system,sans-serif;
  color:#eaf4ff;background:linear-gradient(180deg,#1b2a48,#101a2e);border:1px solid rgba(120,180,255,.4);
  box-shadow:0 6px 16px rgba(0,0,0,.45);opacity:0;pointer-events:none;transform-origin:bottom center;
  transform:translate(-50%,6px) scale(.7);
  transition:opacity .18s ease,transform .3s cubic-bezier(.34,1.56,.64,1)}
.gmc-ghost-say::after{content:'';position:absolute;left:50%;top:100%;transform:translateX(-50%);
  border:5px solid transparent;border-top-color:#101a2e}
.gmc-ghost.is-saying .gmc-ghost-say{opacity:1;transform:translate(-50%,0) scale(1)}

/* poke effect (user pressed on the mascot) */
.gmc-ghost.is-poked .gmc-ghost-img{animation:gmc-ghost-poke .5s cubic-bezier(.34,1.56,.64,1)}
.gmc-ghost-ripple{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px;border-radius:50%;
  border:2px solid rgba(77,214,255,.9);pointer-events:none}
.gmc-ghost-spark{position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px;border-radius:50%;
  background:#4dd6ff;box-shadow:0 0 6px rgba(77,214,255,.9);pointer-events:none}

@media (prefers-reduced-motion: no-preference){
  .gmc-ghost-body{animation:gmc-ghost-float 3.2s ease-in-out infinite}
  .gmc-ghost.is-pending .gmc-ghost-body{animation:gmc-ghost-float 3.2s ease-in-out infinite,gmc-ghost-glow 1.1s ease-in-out infinite}
  .gmc-ghost-type i{animation:gmc-ghost-dot 1.1s ease-in-out infinite}
  .gmc-ghost-type i:nth-child(2){animation-delay:.15s}
  .gmc-ghost-type i:nth-child(3){animation-delay:.3s}
  .gmc-ghost-ripple{animation:gmc-ghost-ripple .55s ease-out forwards}
  .gmc-ghost-spark{animation:gmc-ghost-spark .5s ease-out forwards}
}
.gmc-ghost.is-motion-full .gmc-ghost-body{animation:gmc-ghost-float 3.2s ease-in-out infinite}
.gmc-ghost.is-motion-full.is-pending .gmc-ghost-body{animation:gmc-ghost-float 3.2s ease-in-out infinite,gmc-ghost-glow 1.1s ease-in-out infinite}
.gmc-ghost.is-motion-full .gmc-ghost-type i{animation:gmc-ghost-dot 1.1s ease-in-out infinite}
.gmc-ghost.is-motion-full .gmc-ghost-type i:nth-child(2){animation-delay:.15s}
.gmc-ghost.is-motion-full .gmc-ghost-type i:nth-child(3){animation-delay:.3s}
.gmc-ghost.is-motion-reduced .gmc-ghost-body,.gmc-ghost.is-motion-reduced .gmc-ghost-type i,.gmc-ghost.is-motion-reduced .gmc-ghost-img{animation:none!important}
@keyframes gmc-ghost-float{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-6px) rotate(1.5deg)}}
@keyframes gmc-ghost-glow{0%,100%{filter:drop-shadow(0 0 10px rgba(229,181,59,.65)) drop-shadow(0 4px 7px rgba(0,0,0,.4))}50%{filter:drop-shadow(0 0 18px rgba(229,181,59,1)) drop-shadow(0 4px 7px rgba(0,0,0,.4))}}
@keyframes gmc-ghost-dot{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
@keyframes gmc-ghost-poke{0%{transform:scale(1)}28%{transform:scale(.78)}60%{transform:scale(1.14)}100%{transform:scale(1)}}
@keyframes gmc-ghost-ripple{from{transform:scale(.4);opacity:.9}to{transform:scale(3.2);opacity:0}}
@keyframes gmc-ghost-spark{from{transform:translate(0,0) scale(1);opacity:1}to{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}
@keyframes gmc-ghost-trailfade{from{opacity:.85;transform:scale(1)}to{opacity:0;transform:scale(.2)}}
@keyframes gmc-ghost-startwinkle{0%{opacity:0;transform:translate(0,0) scale(.4)}25%{opacity:1}100%{opacity:0;transform:translate(var(--sx),var(--sy)) scale(1.3)}}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function createGhostCursor(providedMotion?: EmbinderMotionPolicy): GhostCursor {
  injectStyle();
  const motion = providedMotion ?? createEmbinderMotionPolicy();
  const ownsMotion = !providedMotion;
  let reduce = motion.reduced;
  if (motion.hidden) {
    return {
      handle() {},
      destroy() { if (ownsMotion) motion.destroy(); },
    };
  }

  const el = document.createElement('div');
  el.className = 'gmc-ghost';
  el.classList.toggle('is-motion-full', motion.mode === 'full');
  el.classList.toggle('is-motion-reduced', reduce);
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<div class="gmc-ghost-tilt"><div class="gmc-ghost-body"><div class="gmc-ghost-img"></div></div></div>' +
    '<div class="gmc-ghost-type"><i></i><i></i><i></i></div>' +
    '<div class="gmc-ghost-say"></div>';
  document.body.appendChild(el);
  const sayEl = el.querySelector('.gmc-ghost-say') as HTMLElement;
  const tiltEl = el.querySelector('.gmc-ghost-tilt') as HTMLElement;

  // Current on-screen position of the overlay (top-left of its box).
  let curX = MARGIN;
  let curY = innerHeight - SIZE - MARGIN;
  let target: Element | undefined; // set => pointing at an agent's element
  let performing = false; // true while the synthesis engine drives the cursor

  const maxX = () => Math.max(MARGIN, innerWidth - SIZE - MARGIN);
  const maxY = () => Math.max(MARGIN, innerHeight - SIZE - MARGIN);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  const randomSpot = () => ({ x: MARGIN + Math.random() * (maxX() - MARGIN), y: MARGIN + Math.random() * (maxY() - MARGIN) });
  const pointAt = (t: Element) => {
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2 - HOTX * SIZE, y: r.top + r.height / 2 - HOTY * SIZE };
  };

  function setTransform(x: number, y: number) {
    curX = x;
    curY = y;
    // Sub-pixel (no rounding): at the slow wander speed rounding to whole pixels only advances
    // every other frame, which reads as judder. Fractional translate keeps it buttery smooth.
    el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    el.classList.add('is-on');
  }
  // Animated move (CSS transition) — used for agent glides. Duration scales with distance so a
  // short hop stays snappy and a cross-screen flight glides gracefully (a fixed duration makes
  // one feel sluggish and the other feel teleported). Same easing as the base stylesheet.
  function glideTo(x: number, y: number) {
    const dist = Math.hypot(x - curX, y - curY);
    const dur = clamp(dist * 0.9, 320, 780) / 1000; // seconds
    el.style.transition = `transform ${dur.toFixed(2)}s cubic-bezier(.22,1,.36,1), opacity .28s ease`;
    setTransform(x, y);
  }
  // Instant move (no transition) — used per wander frame and for scroll-follow.
  function jumpTo(x: number, y: number) {
    el.style.transition = 'none';
    setTransform(x, y);
  }

  // ---- spaceship trail ----------------------------------------------------
  // Hue drifts cyan -> blue over the age of the trail so the tail feels like a jet stream.
  const TRAIL_HUES = ['#8df0ff', '#4dd6ff', '#37b9f5', '#3b82f6'];
  let trailHue = 0;
  function spawnTrail(x: number, y: number) {
    const d = document.createElement('div');
    d.className = 'gmc-ghost-trail';
    const size = 7 + Math.random() * 6;
    d.style.width = d.style.height = `${size}px`;
    d.style.marginLeft = d.style.marginTop = `${-size / 2}px`;
    d.style.left = `${Math.round(x)}px`;
    d.style.top = `${Math.round(y)}px`;
    d.style.setProperty('--c', TRAIL_HUES[trailHue++ % TRAIL_HUES.length]);
    // longer-lived puffs => a visible comet tail even at the slow wander speed
    d.style.animation = `gmc-ghost-trailfade ${1.2 + Math.random() * 0.5}s ease-out forwards`;
    d.addEventListener('animationend', () => d.remove());
    document.body.appendChild(d);
  }
  // Occasional twinkle star flicked sideways off the jet — sparse, for a bit of magic.
  function spawnStar(x: number, y: number) {
    const s = document.createElement('div');
    s.className = 'gmc-ghost-star';
    s.style.left = `${Math.round(x)}px`;
    s.style.top = `${Math.round(y)}px`;
    s.style.setProperty('--sx', `${Math.round((Math.random() - 0.5) * 34)}px`);
    s.style.setProperty('--sy', `${Math.round(10 + Math.random() * 22)}px`);
    s.style.animation = `gmc-ghost-startwinkle ${0.7 + Math.random() * 0.4}s ease-out forwards`;
    s.addEventListener('animationend', () => s.remove());
    document.body.appendChild(s);
  }

  // ---- idle wander loop (curved path + trail) -----------------------------
  let rafId = 0;
  let lastTs = 0;
  let angle = Math.random() * Math.PI * 2;
  let goal = randomSpot();
  let trailAccum = 0;
  let bank = 0; // current banking angle (deg), eased toward the turn rate

  function frame(ts: number) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    // steer gradually toward the goal -> smooth curves (can't snap to face it)
    let dx = goal.x - curX;
    let dy = goal.y - curY;
    if (Math.hypot(dx, dy) < 46) {
      goal = randomSpot(); // reached it: pick a new drifting destination
      dx = goal.x - curX;
      dy = goal.y - curY;
    }
    const desired = Math.atan2(dy, dx);
    let diff = desired - angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turnStep = clamp(diff, -TURN * dt, TURN * dt);
    angle += turnStep;
    angle += Math.sin(ts / 1100) * 0.35 * dt; // gentle organic wobble, frame-rate independent

    // banking: lean into the turn, eased toward a target proportional to turn rate.
    const bankTarget = clamp((turnStep / Math.max(dt, 0.001)) * 7, -13, 13);
    bank += (bankTarget - bank) * Math.min(1, dt * 6);
    tiltEl.style.transform = `rotate(${bank.toFixed(2)}deg)`;

    // emit a trail puff every ~65ms from just behind the mascot (its jet)
    trailAccum += dt;
    const trail = () => {
      if (trailAccum >= 0.065) {
        trailAccum = 0;
        const jx = curX + SIZE * 0.5 - Math.cos(angle) * 10;
        const jy = curY + SIZE * 0.52 - Math.sin(angle) * 10;
        spawnTrail(jx, jy);
        if (Math.random() < 0.14) spawnStar(jx, jy); // ~1 in 7 puffs flicks a sparkle
      }
    };
    if (performing) {
      trail(); // trail the driven drag / the flight to the target too
      rafId = 0; // loop paused; release() will call startWander() to resume
      return;
    }
    let nx = curX + Math.cos(angle) * SPEED * dt;
    let ny = curY + Math.sin(angle) * SPEED * dt;
    // bounce softly off the edges
    if (nx < MARGIN || nx > maxX()) { angle = Math.PI - angle; nx = clamp(nx, MARGIN, maxX()); }
    if (ny < MARGIN || ny > maxY()) { angle = -angle; ny = clamp(ny, MARGIN, maxY()); }
    jumpTo(nx, ny);
    trail();
    rafId = requestAnimationFrame(frame);
  }

  function startWander() {
    if (reduce || rafId) return; // reduced-motion: rest instead of roaming
    lastTs = 0;
    goal = randomSpot();
    rafId = requestAnimationFrame(frame);
  }
  function stopWander() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    bank = 0;
    tiltEl.style.transform = 'rotate(0deg)'; // level out when it glides to a target
  }

  // ---- react to the user's REAL cursor -----------------------------------
  const overMascot = (cx: number, cy: number) => {
    const r = el.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };
  let moveRaf = 0;
  let lastX = 0;
  let lastY = 0;
  const onMove = (e: PointerEvent) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      el.classList.toggle('is-shy', overMascot(lastX, lastY));
    });
  };

  let sayTimer: ReturnType<typeof setTimeout> | undefined;
  function say() {
    sayEl.textContent = SAYINGS[Math.floor(Math.random() * SAYINGS.length)];
    el.classList.remove('is-saying');
    void el.offsetWidth; // restart the pop on rapid repeat clicks
    el.classList.add('is-saying');
    if (sayTimer) clearTimeout(sayTimer);
    sayTimer = setTimeout(() => el.classList.remove('is-saying'), 1600);
  }
  function poke() {
    say(); // the speech bubble shows regardless of reduced-motion
    if (reduce) return; // honour reduced-motion: skip the burst
    el.classList.remove('is-poked');
    void el.offsetWidth;
    el.classList.add('is-poked');
    const ripple = document.createElement('div');
    ripple.className = 'gmc-ghost-ripple';
    ripple.addEventListener('animationend', () => ripple.remove());
    el.appendChild(ripple);
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('i');
      s.className = 'gmc-ghost-spark';
      const ang = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      const dist = 26 + Math.random() * 12;
      s.style.setProperty('--dx', `${Math.round(Math.cos(ang) * dist)}px`);
      s.style.setProperty('--dy', `${Math.round(Math.sin(ang) * dist)}px`);
      s.addEventListener('animationend', () => s.remove());
      el.appendChild(s);
    }
  }
  const onDown = (e: PointerEvent) => {
    if (overMascot(e.clientX, e.clientY)) poke();
  };

  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });

  // While pointing at an agent element, follow it as the page scrolls/resizes.
  let followRaf = 0;
  const retrack = () => {
    if (followRaf || !target) return;
    followRaf = requestAnimationFrame(() => {
      followRaf = 0;
      if (target && (target as Element).isConnected) {
        const p = pointAt(target);
        jumpTo(p.x, p.y);
      }
    });
  };
  addEventListener('scroll', retrack, { passive: true, capture: true });
  addEventListener('resize', retrack, { passive: true });

  // After an action finishes, clear the state and resume idle wandering.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resumeIdle = (ms: number) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      el.classList.remove('is-working', 'is-pending', 'is-denied');
      target = undefined;
      startWander();
    }, reduce ? 0 : ms);
  };
  const cancelIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  function goTarget(name: string, itemId?: string, scopeId?: string) {
    const t = resolveAgentTarget(name, itemId, scopeId);
    target = t;
    if (t) {
      const p = pointAt(t);
      glideTo(p.x, p.y);
    }
  }

  // Appear immediately, then start roaming.
  jumpTo(curX, curY);
  let active: { id: string; name: string; itemId?: string } | undefined;
  const unsubscribeMotion = motion.subscribe((nextReduced) => {
    if (nextReduced === reduce) return;
    reduce = nextReduced;
    el.classList.toggle('is-motion-reduced', reduce);
    if (reduce) {
      stopWander();
    } else if (!active && !target && !performing) {
      startWander();
    }
  });
  startWander();

  setGhostController({
    driveTo(px: number, py: number) {
      performing = true;
      el.style.transition = 'none';
      cancelIdle();
      el.classList.add('is-working');
      jumpTo(px - HOTX * SIZE, py - HOTY * SIZE); // finger-tip lands on (px,py)
    },
    release() {
      performing = false;
      el.classList.remove('is-working');
      startWander(); // resume wandering from here
    },
  });

  return {
    handle(m: PhaseMessage) {
      switch (m.type) {
        case 'intent':
          if (!m.id || !m.name) break;
          active = { id: m.id, name: m.name, itemId: (m.argsPreview as { id?: string } | undefined)?.id };
          cancelIdle();
          stopWander();
          el.classList.remove('is-pending', 'is-denied');
          el.classList.add('is-working');
          goTarget(m.name, active.itemId);
          break;

        case 'focus':
          if (!m.name) break;
          cancelIdle(); stopWander(); el.classList.add('is-working');
          goTarget(m.name, (m.argsPreview as { id?: string } | undefined)?.id, m.scopeId);
          resumeIdle(700);
          break;

        case 'gate':
          if (!active || m.id !== active.id) break;
          cancelIdle();
          stopWander();
          goTarget(active.name, active.itemId);
          el.classList.toggle('is-pending', m.status === 'awaiting');
          break;

        case 'decided':
          if (!active || m.id !== active.id) break;
          el.classList.remove('is-pending');
          if (m.decision === 'denied') {
            el.classList.remove('is-working');
            el.classList.add('is-denied');
            resumeIdle(1300);
            active = undefined;
          }
          break;

        case 'call':
          if (!active || m.id !== active.id) break;
          cancelIdle();
          stopWander();
          el.classList.remove('is-pending');
          el.classList.add('is-working');
          goTarget(active.name, active.itemId);
          break;

        case 'done':
          if (!active || m.id !== active.id) break;
          el.classList.remove('is-working');
          resumeIdle(900);
          active = undefined;
          break;
      }
    },
    destroy() {
      setGhostController(undefined);
      cancelIdle();
      unsubscribeMotion();
      if (ownsMotion) motion.destroy();
      stopWander();
      if (sayTimer) clearTimeout(sayTimer);
      if (followRaf) cancelAnimationFrame(followRaf);
      if (moveRaf) cancelAnimationFrame(moveRaf);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerdown', onDown);
      removeEventListener('scroll', retrack, { capture: true } as EventListenerOptions);
      removeEventListener('resize', retrack);
      el.remove();
    },
  };
}
