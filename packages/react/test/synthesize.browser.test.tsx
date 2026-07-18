import { describe, it, expect } from 'vitest';
import { performDrag } from '../src/actions/synthesize.js';

describe('performDrag (real events)', () => {
  it('fires the pointer + drag sequence landing on the target', async () => {
    document.body.innerHTML = '';
    const src = document.createElement('div');
    const tgt = document.createElement('div');
    for (const [el, x] of [[src, 10], [tgt, 300]] as const) {
      el.style.position = 'fixed';
      el.style.top = '10px';
      el.style.left = `${x}px`;
      el.style.width = '80px';
      el.style.height = '80px';
      document.body.appendChild(el);
    }

    const seen: string[] = [];
    src.addEventListener('dragstart', () => seen.push('dragstart'));
    src.addEventListener('pointerdown', () => seen.push('pointerdown'));
    tgt.addEventListener('drop', () => seen.push('drop'));
    tgt.addEventListener('pointerup', () => seen.push('pointerup'));

    await performDrag(src, tgt);

    expect(seen).toContain('pointerdown');
    expect(seen).toContain('dragstart');
    expect(seen).toContain('drop');
    expect(seen).toContain('pointerup');
  });
});
