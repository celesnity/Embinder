import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { setupFakeRelay, loadSdk, socket } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentScope', () => {
  it('declares semantic scope and gives child tools its scope id', async () => {
    const { EmbinderProvider, AgentScope, useEmbinder } = await loadSdk();
    function Child() {
      const bind = useEmbinder({ name: 'archive_task', description: 'Archive', handler: () => ({ ok: true }) });
      return <button {...bind}>Archive</button>;
    }
    const { getByText, unmount } = render(<EmbinderProvider chat={false}><AgentScope name="inbox" summary={() => ({ count: 2 })}><Child /></AgentScope></EmbinderProvider>);
    expect(getByText('Archive').parentElement?.getAttribute('data-embinder-scope')).toBe('inbox');
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('scope-register')).toHaveLength(1));
    expect(ws.ofType('scope-register')[0]).toMatchObject({ scope: { id: 'inbox', name: 'inbox' } });
    await waitFor(() => expect(ws.ofType('scope-context')).toHaveLength(1));
    expect(ws.ofType('scope-context')[0]).toMatchObject({ id: 'inbox', state: { count: 2 } });
    expect((ws.ofType('register')[0] as any).tool.annotations).toMatchObject({ embinderScope: 'inbox' });
    unmount();
    await waitFor(() => expect(ws.ofType('scope-unregister')).toHaveLength(1));
  });
});
