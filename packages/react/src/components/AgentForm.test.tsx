import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { z } from 'zod';
import { setupFakeRelay, loadSdk, socket, callTool } from './agent-test-harness.js';

setupFakeRelay();

describe('AgentForm', () => {
  it('registers one submit tool with the raw field schema, destructive hint, and form anchor', async () => {
    const { EmbinderProvider, AgentForm } = await loadSdk();
    const { getByTestId } = render(
      <EmbinderProvider chat={false}>
        <AgentForm
          name="login"
          description="Log in"
          destructive
          data-testid="login-form"
          fields={{ email: z.string().email(), password: z.string() }}
          onSubmit={() => {}}
        >
          <input name="email" />
          <input name="password" type="password" />
        </AgentForm>
      </EmbinderProvider>,
    );
    expect(getByTestId('login-form').getAttribute('data-embinder-tool')).toBe('submit_login');
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register')).toHaveLength(1));
    const tool = (ws.ofType('register')[0] as any).tool;
    expect(tool).toMatchObject({
      name: 'submit_login',
      description: 'Log in',
      annotations: { destructiveHint: true },
    });
    expect(tool.inputSchema.properties).toMatchObject({
      email: { type: 'string' },
      password: { type: 'string' },
    });
    expect(tool.inputSchema.required).toEqual(['email', 'password']);
  });

  it('updates controlled native inputs and submits all agent-supplied fields', async () => {
    const { EmbinderProvider, AgentForm } = await loadSdk();
    const onSubmit = vi.fn();
    const onEmailChange = vi.fn();

    function ControlledForm() {
      const [email, setEmail] = useState('');
      const [password, setPassword] = useState('');
      const [remember, setRemember] = useState(false);
      return (
        <AgentForm
          name="login"
          description="Log in"
          fields={{ email: z.string().email(), password: z.string(), remember: z.boolean() }}
          onSubmit={onSubmit}
        >
          <input
            data-testid="email"
            name="email"
            value={email}
            onChange={(event) => {
              onEmailChange(event.target.value);
              setEmail(event.target.value);
            }}
          />
          <input
            data-testid="password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <input
            data-testid="remember"
            name="remember"
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
        </AgentForm>
      );
    }

    const { getByTestId } = render(
      <EmbinderProvider chat={false}>
        <ControlledForm />
      </EmbinderProvider>,
    );
    const email = getByTestId('email') as HTMLInputElement;
    const remember = getByTestId('remember') as HTMLInputElement;
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register')).toHaveLength(1));

    callTool(ws, 'submit_login', { email: 'a@b.co', password: 'secret', remember: true });
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ email: 'a@b.co', password: 'secret', remember: true }),
    );
    expect(onEmailChange).toHaveBeenCalledWith('a@b.co');
    expect(email.value).toBe('a@b.co');
    expect(remember.checked).toBe(true);
    await waitFor(() =>
      expect(ws.ofType('result')[0]).toMatchObject({
        result: { ok: true, submitted: { email: 'a@b.co', password: 'secret', remember: true } },
      }),
    );
  });

  it('warns and omits a declared field without a matching DOM control', async () => {
    const { EmbinderProvider, AgentForm } = await loadSdk();
    const onSubmit = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <EmbinderProvider chat={false}>
        <AgentForm
          name="login"
          description="Log in"
          fields={{ email: z.string().email(), ghost: z.string() }}
          onSubmit={onSubmit}
        >
          <input name="email" />
        </AgentForm>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register')).toHaveLength(1));

    callTool(ws, 'submit_login', { email: 'x@y.co', ghost: 'skip' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ email: 'x@y.co' }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ghost'));
    warn.mockRestore();
  });

  it('warns and omits declared radio and file inputs while submitting supported fields', async () => {
    const { EmbinderProvider, AgentForm } = await loadSdk();
    const onSubmit = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <EmbinderProvider chat={false}>
        <AgentForm
          name="profile"
          description="Update profile"
          fields={{ email: z.string().email(), choice: z.string(), attachment: z.string() }}
          onSubmit={onSubmit}
        >
          <input name="email" />
          <input name="choice" type="radio" value="one" />
          <input name="attachment" type="file" />
        </AgentForm>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register')).toHaveLength(1));

    callTool(ws, 'submit_profile', { email: 'x@y.co', choice: 'one', attachment: 'resume.pdf' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ email: 'x@y.co' }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('choice'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('attachment'));
    await waitFor(() =>
      expect(ws.ofType('result')[0]).toMatchObject({
        result: { ok: true, submitted: { email: 'x@y.co' } },
      }),
    );
    warn.mockRestore();
  });

  it('fills textarea and select controls through the tool path before submitting their current values', async () => {
    const { EmbinderProvider, AgentForm } = await loadSdk();
    const onSubmit = vi.fn();

    function ControlledForm() {
      const [bio, setBio] = useState('');
      const [role, setRole] = useState('');
      return (
        <AgentForm
          name="profile"
          description="Update profile"
          fields={{ bio: z.string(), role: z.string() }}
          onSubmit={onSubmit}
        >
          <textarea data-testid="bio" name="bio" value={bio} onChange={(event) => setBio(event.target.value)} />
          <select data-testid="role" name="role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">Select a role</option>
            <option value="admin">Admin</option>
          </select>
        </AgentForm>
      );
    }

    const { getByTestId } = render(
      <EmbinderProvider chat={false}>
        <ControlledForm />
      </EmbinderProvider>,
    );
    const bio = getByTestId('bio') as HTMLTextAreaElement;
    const role = getByTestId('role') as HTMLSelectElement;
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register')).toHaveLength(1));

    callTool(ws, 'submit_profile', { bio: 'Works remotely', role: 'admin' });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ bio: 'Works remotely', role: 'admin' }));
    expect(bio.value).toBe('Works remotely');
    expect(role.value).toBe('admin');
    await waitFor(() =>
      expect(ws.ofType('result')[0]).toMatchObject({
        result: { ok: true, submitted: { bio: 'Works remotely', role: 'admin' } },
      }),
    );
  });

  it('submits native human form events through the same handler', async () => {
    const { EmbinderProvider, AgentForm } = await loadSdk();
    const onSubmit = vi.fn();
    const { getByRole } = render(
      <EmbinderProvider chat={false}>
        <AgentForm
          name="login"
          description="Log in"
          fields={{ email: z.string().email() }}
          onSubmit={onSubmit}
        >
          <input name="email" defaultValue="human@y.co" />
          <button type="submit">Submit</button>
        </AgentForm>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register')).toHaveLength(1));

    fireEvent.click(getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ email: 'human@y.co' }),
    );
  });

  it('propagates a rejected developer submission as a relay error result', async () => {
    const { EmbinderProvider, AgentForm } = await loadSdk();
    render(
      <EmbinderProvider chat={false}>
        <AgentForm
          name="rejecting"
          description="Reject submission"
          fields={{ email: z.string().email() }}
          onSubmit={async () => {
            throw new Error('submit failed');
          }}
        >
          <input name="email" />
        </AgentForm>
      </EmbinderProvider>,
    );
    const ws = await socket();
    await waitFor(() => expect(ws.ofType('register')).toHaveLength(1));

    callTool(ws, 'submit_rejecting', { email: 'x@y.co' });
    await waitFor(() => expect(ws.ofType('result')[0]).toMatchObject({ error: 'Error: submit failed' }));
  });
});
