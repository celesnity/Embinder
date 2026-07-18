// Real DOM-event synthesis, driven frame-by-frame by the ghost cursor. Emits both
// Pointer Events (dnd-kit et al.) and legacy HTML5 Drag/Mouse events (native draggable),
// so it drives whatever handlers the app already has wired.
import { getGhostController } from './ghost-bridge.js';

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function firePointer(el: Element, type: string, x: number, y: number): void {
  el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
    pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, view: window,
  }));
}
function fireMouse(el: Element, type: string, x: number, y: number): void {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window }));
}
function fireDrag(el: Element, type: string, x: number, y: number, dt: DataTransfer): void {
  const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window });
  Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true }); // dataTransfer is readonly on construct
  el.dispatchEvent(ev);
}

// Animate a bezier from → to, calling onFrame each step; drive the mascot if present.
function ghostPath(from: { x: number; y: number }, to: { x: number; y: number }, onFrame: (x: number, y: number) => void): Promise<void> {
  const ghost = getGhostController();
  if (reduce()) {
    ghost?.driveTo(to.x, to.y);
    onFrame(to.x, to.y);
    return Promise.resolve();
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const dur = Math.min(1000, Math.max(400, dist * 1.2));
  const ctrl = {
    x: (from.x + to.x) / 2 + (to.y - from.y) * 0.2,
    y: (from.y + to.y) / 2 - (to.x - from.x) * 0.2,
  };
  const start = performance.now();
  return new Promise<void>((resolve) => {
    function step(now: number): void {
      const t = Math.min(1, (now - start) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const u = 1 - e;
      const x = u * u * from.x + 2 * u * e * ctrl.x + e * e * to.x;
      const y = u * u * from.y + 2 * u * e * ctrl.y + e * e * to.y;
      ghost?.driveTo(x, y);
      onFrame(x, y);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

export async function performScroll(el: Element): Promise<void> {
  const ghost = getGhostController();
  const c = center(el);
  ghost?.driveTo(c.x, c.y);
  el.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'center', inline: 'center' });
  await wait(reduce() ? 0 : 500);
  ghost?.release();
}

export async function performDrag(source: Element, target: Element): Promise<void> {
  const ghost = getGhostController();
  const dt = new DataTransfer();
  const from = center(source);
  const to = center(target);
  try {
    firePointer(source, 'pointerdown', from.x, from.y);
    fireMouse(source, 'mousedown', from.x, from.y);
    fireDrag(source, 'dragstart', from.x, from.y, dt);

    let last: Element = source;
    await ghostPath(from, to, (x, y) => {
      const under = document.elementFromPoint(x, y) ?? target;
      firePointer(under, 'pointermove', x, y);
      fireMouse(under, 'mousemove', x, y);
      if (under !== last) {
        fireDrag(last, 'dragleave', x, y, dt);
        fireDrag(under, 'dragenter', x, y, dt);
        last = under;
      }
      fireDrag(under, 'dragover', x, y, dt);
    });

    const under = document.elementFromPoint(to.x, to.y) ?? target;
    fireDrag(under, 'drop', to.x, to.y, dt);
    fireDrag(source, 'dragend', to.x, to.y, dt);
    firePointer(under, 'pointerup', to.x, to.y);
    fireMouse(under, 'mouseup', to.x, to.y);
  } finally {
    ghost?.release();
  }
}
