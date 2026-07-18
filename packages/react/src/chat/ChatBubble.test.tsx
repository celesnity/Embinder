// ChatBubble config behavior (D-9): relay-provided config; unconfigured => hint, no composer.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ChatBubble } from './ChatBubble.js';

function stubConfig(cfg: { baseURL: string | null; model: string | null }) {
  return vi.fn(async (url: unknown) => {
    if (String(url).includes('/chat-config')) return { json: async () => cfg } as Response;
    return { json: async () => ({}) } as Response;
  });
}

beforeEach(() => {
  // jsdom lacks these; assistant-ui touches them during render
  window.HTMLElement.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatBubble (D-9)', () => {
  it('shows the "connect a model" hint when the relay has no LLM config', async () => {
    const fetchSpy = stubConfig({ baseURL: null, model: null });
    vi.stubGlobal('fetch', fetchSpy);
    const { getByLabelText, findByText } = render(<ChatBubble configBase="http://127.0.0.1:7331" />);
    fireEvent.click(getByLabelText('Open chat'));
    expect(await findByText(/Connect a model/i)).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:7331/chat-config');
  });

  it('shows the composer when the relay provides config', async () => {
    vi.stubGlobal('fetch', stubConfig({ baseURL: 'http://127.0.0.1:1234/v1', model: 'qwen' }));
    const { getByLabelText, findByPlaceholderText, queryByText } = render(
      <ChatBubble configBase="http://127.0.0.1:7331" />,
    );
    fireEvent.click(getByLabelText('Open chat'));
    expect(await findByPlaceholderText('Ask the agent…')).toBeTruthy();
    await waitFor(() => expect(queryByText(/Connect a model/i)).toBeNull());
  });
});
