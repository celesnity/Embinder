import { useRef, type ComponentPropsWithoutRef, type FormEvent, type ReactElement } from 'react';
import type { ZodTypeAny } from 'zod';
import { useEmbinder } from '../use-embinder.js';
import { fireCheckbox, fireInputValue, fireSelectValue } from './dispatch.js';

export interface AgentFormProps extends Omit<ComponentPropsWithoutRef<'form'>, 'onSubmit'> {
  name: string;
  description: string;
  fields: Record<string, ZodTypeAny>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  destructive?: boolean;
  title?: string;
}

function firstControl(item: Element | RadioNodeList | null): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement || item instanceof HTMLSelectElement ? item : null;
}

const textInputTypes = new Set([
  'text',
  'email',
  'password',
  'search',
  'tel',
  'url',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

function isSupportedTextInput(control: HTMLInputElement): boolean {
  return textInputTypes.has(control.type);
}

function isSupportedControl(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  return control instanceof HTMLTextAreaElement
    || control instanceof HTMLSelectElement
    || (control instanceof HTMLInputElement && (control.type === 'checkbox' || isSupportedTextInput(control)));
}

function fillControl(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: unknown): boolean {
  if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    fireCheckbox(control, Boolean(value));
    return true;
  }
  if (control instanceof HTMLInputElement && isSupportedTextInput(control) || control instanceof HTMLTextAreaElement) {
    fireInputValue(control, String(value));
    return true;
  }
  if (control instanceof HTMLSelectElement) {
    fireSelectValue(control, String(value));
    return true;
  }
  return false;
}

function collectValues(form: HTMLFormElement, fields: Record<string, ZodTypeAny>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(fields).flatMap((key) => {
    const control = firstControl(form.elements.namedItem(key));
    if (!control || !isSupportedControl(control)) return [];
    return [[key, control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value]];
  }));
}

export function AgentForm({
  name,
  title,
  description,
  fields,
  onSubmit,
  destructive,
  children,
  ...formProps
}: AgentFormProps): ReactElement {
  const formRef = useRef<HTMLFormElement>(null);
  const submitPromiseRef = useRef<Promise<void> | null>(null);

  const handleNativeSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = collectValues(event.currentTarget, fields);
    const pending = Promise.resolve().then(() => onSubmit(values));
    submitPromiseRef.current = pending;
    void pending;
  };

  const bind = useEmbinder({
    name: `submit_${name}`,
    title,
    description,
    destructive,
    input: fields,
    handler: (async (args: Record<string, unknown>) => {
      const form = formRef.current;
      if (!form) return { ok: false, error: 'form_unmounted' };
      for (const [key, value] of Object.entries(args)) {
        const control = firstControl(form.elements.namedItem(key));
        if (!control || !fillControl(control, value)) console.warn(`[embinder] AgentForm "${name}": no fillable field named "${key}"`);
      }
      submitPromiseRef.current = null;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      const pending = submitPromiseRef.current;
      if (!pending) throw new Error(`AgentForm "${name}" did not receive a submit event`);
      await pending;
      return { ok: true, submitted: collectValues(form, fields) };
    }) as (args: never) => Promise<unknown>,
  });

  return <form {...formProps} ref={formRef} onSubmit={handleNativeSubmit} {...bind}>{children}</form>;
}
