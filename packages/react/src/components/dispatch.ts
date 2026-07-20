// Drive real DOM controls the way a user would, so the developer's own React
// onChange/onClick handlers fire. React tracks controlled value/checked internally;
// we bypass that tracker with the prototype's native setter, then dispatch the event
// React actually listens to (input/change for value, click for checkable controls).

function nativeSet(el: HTMLElement, prop: 'value' | 'checked', value: unknown): void {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, prop)?.set?.call(el, value);
}

export function fireInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  nativeSet(el, 'value', value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function fireSelectValue(el: HTMLSelectElement, value: string): void {
  nativeSet(el, 'value', value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function fireCheckbox(el: HTMLInputElement, checked: boolean): void {
  if (el.checked !== checked) el.click();
}

export function clickIfState(
  el: HTMLElement,
  desired: boolean,
  read: (el: HTMLElement) => boolean,
): void {
  if (read(el) !== desired) el.click();
}
