import { describe, it, expect, vi } from 'vitest';
import { fireInputValue, fireSelectValue, fireCheckbox, clickIfState } from './dispatch.js';

describe('dispatch helpers', () => {
  it('fireInputValue sets value and dispatches a bubbling input event', () => {
    const el = document.createElement('input');
    document.body.appendChild(el);
    const onInput = vi.fn();
    el.addEventListener('input', (e) => onInput((e as Event).bubbles));
    fireInputValue(el, 'milk');
    expect(el.value).toBe('milk');
    expect(onInput).toHaveBeenCalledWith(true);
    el.remove();
  });

  it('fireSelectValue sets value and dispatches a change event', () => {
    const el = document.createElement('select');
    for (const v of ['a', 'b']) {
      const o = document.createElement('option');
      o.value = v;
      el.appendChild(o);
    }
    document.body.appendChild(el);
    const onChange = vi.fn();
    el.addEventListener('change', () => onChange(el.value));
    fireSelectValue(el, 'b');
    expect(el.value).toBe('b');
    expect(onChange).toHaveBeenCalledWith('b');
    el.remove();
  });

  it('fireCheckbox clicks only when the desired state differs', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    document.body.appendChild(el);
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    fireCheckbox(el, true);          // was false -> clicks
    expect(el.checked).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireCheckbox(el, true);          // already true -> no click
    expect(onClick).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it('clickIfState clicks only when read(el) !== desired', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-checked', 'false');
    document.body.appendChild(el);
    const onClick = vi.fn(() => {
      const now = el.getAttribute('aria-checked') === 'true';
      el.setAttribute('aria-checked', String(!now));
    });
    el.addEventListener('click', onClick);
    const read = (e: HTMLElement) => e.getAttribute('aria-checked') === 'true';
    clickIfState(el, true, read);    // false -> clicks
    expect(onClick).toHaveBeenCalledTimes(1);
    clickIfState(el, true, read);    // already true -> no click
    expect(onClick).toHaveBeenCalledTimes(1);
    el.remove();
  });
});
