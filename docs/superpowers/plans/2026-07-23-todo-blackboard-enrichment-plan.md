# Todo ⇄ Blackboard Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new `apps/todo` board item automatically becomes a Blackboard Task; a Worker
Agent process (built on last session's `defineLLMHandler`) enriches it with a suggested
priority/tags/due date/subtasks; the result streams back onto the card live over the existing
relay WebSocket, with no page refresh and no extra user action beyond the original add.

**Architecture:** A new relay-local `blackboard-client.ts` (Master-side REST calls: projects,
blackboards, create/list tasks) backs a new `blackboard-bridge.ts` (idempotent startup
bootstrap, a `POST /blackboard-tasks` intake route, an in-memory task-tracking map, and a 3s
poll loop that pushes completed results through the relay's existing `emitToApp` helper).
`@embinder/react`'s ws shim gains one new generic passthrough case (`app-event`) so
`apps/todo` can subscribe without any Embinder-SDK code knowing what "blackboard" or "todo"
means. A new `scripts/todo-worker.mjs` runs the actual `defineLLMHandler`-based Worker Agent,
started by `scripts/dev.mjs` alongside the relay and the todo dev server.

**Tech Stack:** TypeScript, Express (relay routes), native `fetch` (new REST client, matching
`worker-agent-sdk`'s existing `rest-client.ts` style exactly), Vitest with injected-`fetch`
fakes, `@minder/worker-agent-sdk`'s `defineWorkerAgent`/`defineLLMHandler` (both already
shipped, unmodified by this plan).

**Full spec:** [docs/superpowers/specs/2026-07-23-todo-blackboard-enrichment-design.md](../specs/2026-07-23-todo-blackboard-enrichment-design.md)

## Global Constraints

- Node >=20, ESM everywhere, TypeScript `strict: true` — inherited from `tsconfig.base.json`,
  same as every other package in this repo.
- Unit tests substitute `fetch`, never mock the function under test — same tier as
  `worker-agent-sdk`'s `worker.test.ts`/`llm-handler.test.ts`.
- **No changes to `packages/worker-agent-sdk`'s public API.** All new Master-side REST calls
  (project/blackboard/task creation, listing) live in `packages/relay/src/blackboard-client.ts`
  — a separate, relay-local file, not an addition to `worker-agent-sdk`'s `rest-client.ts`.
- **No approval gate on the enrichment path** — `runGatedCall`/`registry.ts` are untouched;
  nothing in this plan routes through them.
- **`store.ts` and its `Task`/`Action` domain types stay unmodified.** The "don't re-notify the
  blackboard for enrichment-created subtasks" guard is a plain function argument
  (`{ skipNotify?: boolean }`) on the new `dispatchAndNotify` wrapper in `App.tsx`, not a new
  field on `Action` or `Task`.
- **`BLACKBOARD_URL` unset => the whole feature is inert**, matching the existing
  `LLM_BASE_URL`-unset-means-chat-is-off convention in `packages/relay/src/chat.ts`. No crash,
  no error surfaced to the UI, todo app behaves exactly as it does today.
- **`scripts/dev.mjs` never reaches into the sibling `agent-blackboard` repo.**
  `blackboard-server` itself is an external prerequisite the developer starts by hand
  (`cargo run -p blackboard-server`), per the spec's explicit non-goal.
- `feature_list.json` is NOT updated for this feature (tracked via spec + this plan only,
  matching `worker-agent-sdk`'s own precedent).

---

### Task 1: `blackboard-client.ts` — Master-side REST client

**Files:**
- Create: `packages/relay/src/blackboard-client.ts`
- Test: `packages/relay/src/blackboard-client.test.ts`

**Interfaces:**
- Produces (all exported from this file only — not re-exported from any package index, this is
  relay-internal):
  ```ts
  export interface BlackboardConfig { baseUrl: string; apiKey: string; }
  export interface Project { id: string; tenant_id: string; name: string; created_at: string; }
  export interface Blackboard { id: string; project_id: string; tenant_id: string; name: string; created_at: string; }
  export type TaskStatus = 'pending' | 'claimed' | 'completed' | 'failed';
  export interface BlackboardTask {
    id: string; tenant_id: string; blackboard_id: string; capability: string; subject: string;
    status: TaskStatus; input: unknown; result: unknown | null; failure_reason: string | null;
    assigned_agent_id: string | null; attempt_count: number; claimed_at: string | null;
    lease_expires_at: string | null; created_at: string; completed_at: string | null;
  }
  export async function listProjects(cfg: BlackboardConfig): Promise<Project[]>
  export async function createProject(cfg: BlackboardConfig, args: { name: string }): Promise<Project>
  export async function listBlackboards(cfg: BlackboardConfig, args: { projectId: string }): Promise<Blackboard[]>
  export async function createBlackboard(cfg: BlackboardConfig, args: { projectId: string; name: string }): Promise<Blackboard>
  export async function createTask(cfg: BlackboardConfig, args: { blackboardId: string; capability: string; subject: string; input: unknown }): Promise<BlackboardTask>
  export async function listTasks(cfg: BlackboardConfig, args: { blackboardId: string; capability?: string; status?: TaskStatus }): Promise<BlackboardTask[]>
  export class BlackboardClientError extends Error { status: number; body: string; }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/relay/src/blackboard-client.test.ts
import { describe, it, expect } from 'vitest';
import {
  listProjects, createProject, listBlackboards, createBlackboard, createTask, listTasks,
  BlackboardClientError, type Project, type Blackboard,
} from './blackboard-client.js';

interface FetchCall { method: string; path: string; body: unknown; headers: Record<string, string>; }

function fakeFetch(route: (call: FetchCall) => Response | undefined): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input : input.toString());
    const call: FetchCall = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    };
    calls.push(call);
    const response = route(call);
    if (!response) throw new Error(`unhandled fake fetch call: ${call.method} ${call.path}`);
    return response;
  }) as typeof fetch;
  return { fetch: fn, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const cfg = { baseUrl: 'http://fake.local', apiKey: 'dev-key' };

describe('blackboard-client', () => {
  it('lists projects with the x-api-key header', async () => {
    const projects: Project[] = [{ id: 'p1', tenant_id: 't1', name: 'todo-app', created_at: 'now' }];
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'GET' && call.path === '/api/v1/projects') return json(200, projects);
      return undefined;
    });
    globalThis.fetch = fetch;
    const result = await listProjects(cfg);
    expect(result).toEqual(projects);
    expect(calls[0]?.headers['x-api-key']).toBe('dev-key');
  });

  it('creates a project with the given name', async () => {
    const created: Project = { id: 'p1', tenant_id: 't1', name: 'todo-app', created_at: 'now' };
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'POST' && call.path === '/api/v1/projects') return json(200, created);
      return undefined;
    });
    globalThis.fetch = fetch;
    const result = await createProject(cfg, { name: 'todo-app' });
    expect(result).toEqual(created);
    expect(calls[0]?.body).toEqual({ name: 'todo-app' });
  });

  it('lists blackboards filtered by project_id query param', async () => {
    const boards: Blackboard[] = [{ id: 'b1', project_id: 'p1', tenant_id: 't1', name: 'todo-app', created_at: 'now' }];
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'GET' && call.path === '/api/v1/blackboards?project_id=p1') return json(200, boards);
      return undefined;
    });
    globalThis.fetch = fetch;
    const result = await listBlackboards(cfg, { projectId: 'p1' });
    expect(result).toEqual(boards);
    expect(calls).toHaveLength(1);
  });

  it('creates a blackboard inside a project', async () => {
    const created: Blackboard = { id: 'b1', project_id: 'p1', tenant_id: 't1', name: 'todo-app', created_at: 'now' };
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'POST' && call.path === '/api/v1/blackboards') return json(200, created);
      return undefined;
    });
    globalThis.fetch = fetch;
    const result = await createBlackboard(cfg, { projectId: 'p1', name: 'todo-app' });
    expect(result).toEqual(created);
    expect(calls[0]?.body).toEqual({ project_id: 'p1', name: 'todo-app' });
  });

  it('creates a task with capability/subject/input', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'POST' && call.path === '/api/v1/tasks') {
        return json(200, { id: 'task-1', tenant_id: 't1', blackboard_id: 'b1', capability: 'todo-enrich', subject: 'buy milk', status: 'pending', input: { text: 'buy milk' }, result: null, failure_reason: null, assigned_agent_id: null, attempt_count: 0, claimed_at: null, lease_expires_at: null, created_at: 'now', completed_at: null });
      }
      return undefined;
    });
    globalThis.fetch = fetch;
    const result = await createTask(cfg, { blackboardId: 'b1', capability: 'todo-enrich', subject: 'buy milk', input: { text: 'buy milk' } });
    expect(result.id).toBe('task-1');
    expect(calls[0]?.body).toEqual({ blackboard_id: 'b1', capability: 'todo-enrich', subject: 'buy milk', input: { text: 'buy milk' } });
  });

  it('lists tasks filtered by blackboard/capability/status', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'GET' && call.path === '/api/v1/tasks?blackboard_id=b1&capability=todo-enrich&status=completed') return json(200, []);
      return undefined;
    });
    globalThis.fetch = fetch;
    await listTasks(cfg, { blackboardId: 'b1', capability: 'todo-enrich', status: 'completed' });
    expect(calls).toHaveLength(1);
  });

  it('throws BlackboardClientError on a non-2xx response', async () => {
    const { fetch } = fakeFetch((call) => {
      if (call.method === 'GET' && call.path === '/api/v1/projects') return json(500, { error: 'db down' });
      return undefined;
    });
    globalThis.fetch = fetch;
    await expect(listProjects(cfg)).rejects.toBeInstanceOf(BlackboardClientError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @embinder/relay -- blackboard-client.test.ts`
Expected: FAIL — `./blackboard-client.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// packages/relay/src/blackboard-client.ts
// Master-side REST calls against agent-blackboard (a separate sibling repo's Rust server) —
// project/blackboard bootstrap + task creation/listing. Deliberately separate from
// worker-agent-sdk's rest-client.ts (Worker-only, see that package's design spec's Non-goals);
// this file is relay-internal, never exported from the package's public surface.

export interface BlackboardConfig {
  baseUrl: string;
  apiKey: string;
}

export interface Project {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
}

export interface Blackboard {
  id: string;
  project_id: string;
  tenant_id: string;
  name: string;
  created_at: string;
}

export type TaskStatus = 'pending' | 'claimed' | 'completed' | 'failed';

export interface BlackboardTask {
  id: string;
  tenant_id: string;
  blackboard_id: string;
  capability: string;
  subject: string;
  status: TaskStatus;
  input: unknown;
  result: unknown | null;
  failure_reason: string | null;
  assigned_agent_id: string | null;
  attempt_count: number;
  claimed_at: string | null;
  lease_expires_at: string | null;
  created_at: string;
  completed_at: string | null;
}

export class BlackboardClientError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = 'BlackboardClientError';
    this.status = status;
    this.body = body;
  }
  static async fromResponse(response: Response): Promise<BlackboardClientError> {
    const body = await response.text();
    let message = `request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (typeof parsed.error === 'string') message = parsed.error;
    } catch {
      /* non-JSON error body */
    }
    return new BlackboardClientError(response.status, body, message);
  }
}

async function requestJson<T>(cfg: BlackboardConfig, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, cfg.baseUrl), {
    ...init,
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, ...init?.headers },
  });
  if (!response.ok) throw await BlackboardClientError.fromResponse(response);
  return (await response.json()) as T;
}

export async function listProjects(cfg: BlackboardConfig): Promise<Project[]> {
  return requestJson<Project[]>(cfg, '/api/v1/projects', { method: 'GET' });
}

export async function createProject(cfg: BlackboardConfig, args: { name: string }): Promise<Project> {
  return requestJson<Project>(cfg, '/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: args.name }),
  });
}

export async function listBlackboards(
  cfg: BlackboardConfig,
  args: { projectId: string },
): Promise<Blackboard[]> {
  const params = new URLSearchParams({ project_id: args.projectId });
  return requestJson<Blackboard[]>(cfg, `/api/v1/blackboards?${params.toString()}`, { method: 'GET' });
}

export async function createBlackboard(
  cfg: BlackboardConfig,
  args: { projectId: string; name: string },
): Promise<Blackboard> {
  return requestJson<Blackboard>(cfg, '/api/v1/blackboards', {
    method: 'POST',
    body: JSON.stringify({ project_id: args.projectId, name: args.name }),
  });
}

export async function createTask(
  cfg: BlackboardConfig,
  args: { blackboardId: string; capability: string; subject: string; input: unknown },
): Promise<BlackboardTask> {
  return requestJson<BlackboardTask>(cfg, '/api/v1/tasks', {
    method: 'POST',
    body: JSON.stringify({
      blackboard_id: args.blackboardId,
      capability: args.capability,
      subject: args.subject,
      input: args.input,
    }),
  });
}

export async function listTasks(
  cfg: BlackboardConfig,
  args: { blackboardId: string; capability?: string; status?: TaskStatus },
): Promise<BlackboardTask[]> {
  const params = new URLSearchParams({ blackboard_id: args.blackboardId });
  if (args.capability) params.set('capability', args.capability);
  if (args.status) params.set('status', args.status);
  return requestJson<BlackboardTask[]>(cfg, `/api/v1/tasks?${params.toString()}`, { method: 'GET' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @embinder/relay -- blackboard-client.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/blackboard-client.ts packages/relay/src/blackboard-client.test.ts
git commit -m "feat(relay): add Master-side blackboard-client REST wrapper"
```

---

### Task 2: `blackboard-bridge.ts` — bootstrap, intake route, poll loop

**Files:**
- Create: `packages/relay/src/blackboard-bridge.ts`
- Test: `packages/relay/src/blackboard-bridge.test.ts`

**Interfaces:**
- Consumes: everything from Task 1's `blackboard-client.ts` (`BlackboardConfig`, `Project`,
  `Blackboard`, `BlackboardTask`, `listProjects`, `createProject`, `listBlackboards`,
  `createBlackboard`, `createTask`, `listTasks`).
- Produces:
  ```ts
  export interface BootstrapResult { projectId: string; blackboardId: string; }
  export async function bootstrapProject(cfg: BlackboardConfig, name: string): Promise<BootstrapResult>

  export interface BlackboardBridgeDeps {
    cfg: BlackboardConfig;
    blackboardId: string;
    emit: (type: string, payload: Record<string, unknown>) => void;
  }
  export function mountBlackboardTaskRoute(app: Express, deps: BlackboardBridgeDeps): void
  // Mounts POST /blackboard-tasks, body: { todoTaskId: string; text: string; priority?: string; tags?: string[]; due?: string | null }
  // -> creates a BlackboardTask (capability 'todo-enrich'), tracks taskId -> todoTaskId, responds { ok: true, taskId }.

  export function startBlackboardPollLoop(deps: BlackboardBridgeDeps, intervalMs?: number): { stop(): void }
  // Every intervalMs (default 3000), lists tasks for deps.blackboardId/capability 'todo-enrich',
  // checks each locally-tracked id for status "completed"/"failed"; on completed, deps.emit('app-event',
  // { name: 'blackboard-enrich-result', todoTaskId, result: task.result }) and stops tracking it;
  // on failed, deps.emit('app-event', { name: 'blackboard-enrich-failed', todoTaskId, reason: task.failure_reason }).
  ```
  A single module-level `Map<string, string>` (taskId -> todoTaskId) is shared between the route
  and the poll loop within one `blackboard-bridge.ts` module instance — the relay is a single
  process with a single connected browser tab at a time (see `server.ts`'s single `appSocket`),
  so there is no need to key tracking by session; `deps.emit` always reaches whichever tab is
  currently connected, mirroring how `emitToApp` already works today.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/relay/src/blackboard-bridge.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import {
  bootstrapProject, mountBlackboardTaskRoute, startBlackboardPollLoop,
} from './blackboard-bridge.js';

interface FetchCall { method: string; path: string; body: unknown; }

function fakeFetch(route: (call: FetchCall) => Response | undefined): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input : input.toString());
    const call: FetchCall = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const response = route(call);
    if (!response) throw new Error(`unhandled fake fetch call: ${call.method} ${call.path}`);
    return response;
  }) as typeof fetch;
  return { fetch: fn, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const cfg = { baseUrl: 'http://fake.local', apiKey: 'dev-key' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bootstrapProject', () => {
  it('creates the project and blackboard when neither exists', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'GET' && call.path === '/api/v1/projects') return json(200, []);
      if (call.method === 'POST' && call.path === '/api/v1/projects') return json(200, { id: 'p1', tenant_id: 't1', name: 'todo-app', created_at: 'now' });
      if (call.method === 'GET' && call.path === '/api/v1/blackboards?project_id=p1') return json(200, []);
      if (call.method === 'POST' && call.path === '/api/v1/blackboards') return json(200, { id: 'b1', project_id: 'p1', tenant_id: 't1', name: 'todo-app', created_at: 'now' });
      return undefined;
    });
    vi.stubGlobal('fetch', fetch);
    const result = await bootstrapProject(cfg, 'todo-app');
    expect(result).toEqual({ projectId: 'p1', blackboardId: 'b1' });
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/projects')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/v1/blackboards')).toHaveLength(1);
  });

  it('finds the existing project and blackboard by name instead of creating duplicates', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'GET' && call.path === '/api/v1/projects') return json(200, [{ id: 'p1', tenant_id: 't1', name: 'todo-app', created_at: 'now' }]);
      if (call.method === 'GET' && call.path === '/api/v1/blackboards?project_id=p1') return json(200, [{ id: 'b1', project_id: 'p1', tenant_id: 't1', name: 'todo-app', created_at: 'now' }]);
      return undefined;
    });
    vi.stubGlobal('fetch', fetch);
    const result = await bootstrapProject(cfg, 'todo-app');
    expect(result).toEqual({ projectId: 'p1', blackboardId: 'b1' });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('mountBlackboardTaskRoute', () => {
  it('creates a Task and responds with its id', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'POST' && call.path === '/api/v1/tasks') {
        return json(200, { id: 'task-1', tenant_id: 't1', blackboard_id: 'b1', capability: 'todo-enrich', subject: 'buy milk', status: 'pending', input: call.body, result: null, failure_reason: null, assigned_agent_id: null, attempt_count: 0, claimed_at: null, lease_expires_at: null, created_at: 'now', completed_at: null });
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetch);

    const app = express();
    app.use(express.json());
    const emit = vi.fn();
    mountBlackboardTaskRoute(app, { cfg, blackboardId: 'b1', emit });
    const server = await new Promise<{ close(): void; port: number }>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve({ close: () => s.close(), port: (s.address() as { port: number }).port }));
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/blackboard-tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ todoTaskId: 't-abc', text: 'buy milk' }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, taskId: 'task-1' });
    const createCall = calls.find((c) => c.path === '/api/v1/tasks');
    expect(createCall?.body).toMatchObject({ blackboard_id: 'b1', capability: 'todo-enrich', subject: 'buy milk' });
    server.close();
  });
});

describe('startBlackboardPollLoop', () => {
  it('emits blackboard-enrich-result once a tracked task completes, then stops tracking it', async () => {
    vi.useFakeTimers();
    let listCalls = 0;
    const { fetch } = fakeFetch((call) => {
      if (call.method === 'POST' && call.path === '/api/v1/tasks') {
        return json(200, { id: 'task-1', tenant_id: 't1', blackboard_id: 'b1', capability: 'todo-enrich', subject: 'buy milk', status: 'pending', input: {}, result: null, failure_reason: null, assigned_agent_id: null, attempt_count: 0, claimed_at: null, lease_expires_at: null, created_at: 'now', completed_at: null });
      }
      if (call.method === 'GET' && call.path.startsWith('/api/v1/tasks?')) {
        listCalls += 1;
        const status = listCalls === 1 ? 'pending' : 'completed';
        return json(200, [{ id: 'task-1', tenant_id: 't1', blackboard_id: 'b1', capability: 'todo-enrich', subject: 'buy milk', status, input: {}, result: listCalls === 1 ? null : { priority: 'high' }, failure_reason: null, assigned_agent_id: null, attempt_count: 0, claimed_at: null, lease_expires_at: null, created_at: 'now', completed_at: null }]);
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetch);

    const app = express();
    app.use(express.json());
    const emit = vi.fn();
    const deps = { cfg, blackboardId: 'b1', emit };
    mountBlackboardTaskRoute(app, deps);
    const server = await new Promise<{ close(): void; port: number }>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve({ close: () => s.close(), port: (s.address() as { port: number }).port }));
    });
    await fetch(`http://127.0.0.1:${server.port}/blackboard-tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ todoTaskId: 't-abc', text: 'buy milk' }),
    });

    const loop = startBlackboardPollLoop(deps, 1000);
    await vi.advanceTimersByTimeAsync(1000); // first tick: still pending
    expect(emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); // second tick: completed
    expect(emit).toHaveBeenCalledWith('app-event', {
      name: 'blackboard-enrich-result', todoTaskId: 't-abc', result: { priority: 'high' },
    });

    emit.mockClear();
    await vi.advanceTimersByTimeAsync(1000); // third tick: no longer tracked, no re-emit
    expect(emit).not.toHaveBeenCalled();

    loop.stop();
    server.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @embinder/relay -- blackboard-bridge.test.ts`
Expected: FAIL — `./blackboard-bridge.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// packages/relay/src/blackboard-bridge.ts
// Wires apps/todo's board to the sibling agent-blackboard system: bootstrap (idempotent
// find-or-create of a project+blackboard), the browser-facing intake route, and a poll loop
// that surfaces completed enrichment results back to the app over the relay's existing
// emitToApp mechanism. See docs/superpowers/specs/2026-07-23-todo-blackboard-enrichment-design.md.

import type { Express, Request, Response } from 'express';
import {
  listProjects, createProject, listBlackboards, createBlackboard, createTask, listTasks,
  type BlackboardConfig,
} from './blackboard-client.js';

const CAPABILITY = 'todo-enrich';

export interface BootstrapResult {
  projectId: string;
  blackboardId: string;
}

/** Idempotent by `name`: a second call against a server that already has the project+blackboard
 * finds them instead of creating duplicates. Two processes calling this concurrently against a
 * cold server (relay + todo-worker.mjs both bootstrapping at startup) can both observe "not
 * found" and both create — an accepted, documented race for a local dev/demo feature, not
 * engineered around (see the design spec's Non-goals / Error Handling). */
export async function bootstrapProject(cfg: BlackboardConfig, name: string): Promise<BootstrapResult> {
  const projects = await listProjects(cfg);
  const project = projects.find((p) => p.name === name) ?? (await createProject(cfg, { name }));

  const boards = await listBlackboards(cfg, { projectId: project.id });
  const board = boards.find((b) => b.name === name) ?? (await createBlackboard(cfg, { projectId: project.id, name }));

  return { projectId: project.id, blackboardId: board.id };
}

export interface BlackboardBridgeDeps {
  cfg: BlackboardConfig;
  blackboardId: string;
  emit: (type: string, payload: Record<string, unknown>) => void;
}

// taskId -> todoTaskId. Single-process, single-connected-tab model (see server.ts's one
// appSocket) — no need to key by session.
const tracked = new Map<string, string>();

export function mountBlackboardTaskRoute(app: Express, deps: BlackboardBridgeDeps): void {
  app.post('/blackboard-tasks', async (req: Request, res: Response) => {
    const { todoTaskId, text, priority, tags, due } = (req.body ?? {}) as {
      todoTaskId?: string; text?: string; priority?: string; tags?: string[]; due?: string | null;
    };
    if (!todoTaskId || !text) {
      return res.status(400).json({ error: 'todoTaskId and text required' });
    }
    try {
      const task = await createTask(deps.cfg, {
        blackboardId: deps.blackboardId,
        capability: CAPABILITY,
        subject: text,
        input: { text, priority, tags, due },
      });
      tracked.set(task.id, todoTaskId);
      res.json({ ok: true, taskId: task.id });
    } catch (error) {
      console.error('[embinder] blackboard-tasks create failed:', error);
      res.status(502).json({ error: 'blackboard_unreachable' });
    }
  });
}

export function startBlackboardPollLoop(
  deps: BlackboardBridgeDeps,
  intervalMs = 3000,
): { stop(): void } {
  const timer = setInterval(() => {
    void (async () => {
      if (tracked.size === 0) return;
      let tasks;
      try {
        tasks = await listTasks(deps.cfg, { blackboardId: deps.blackboardId, capability: CAPABILITY });
      } catch (error) {
        console.error('[embinder] blackboard poll failed:', error);
        return;
      }
      for (const task of tasks) {
        const todoTaskId = tracked.get(task.id);
        if (!todoTaskId) continue;
        if (task.status === 'completed') {
          deps.emit('app-event', { name: 'blackboard-enrich-result', todoTaskId, result: task.result });
          tracked.delete(task.id);
        } else if (task.status === 'failed') {
          deps.emit('app-event', { name: 'blackboard-enrich-failed', todoTaskId, reason: task.failure_reason });
          tracked.delete(task.id);
        }
      }
    })();
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @embinder/relay -- blackboard-bridge.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/blackboard-bridge.ts packages/relay/src/blackboard-bridge.test.ts
git commit -m "feat(relay): add blackboard bootstrap, intake route, and result poll loop"
```

---

### Task 3: Wire `blackboard-bridge.ts` into `server.ts`

**Files:**
- Modify: `packages/relay/src/server.ts`

**Interfaces:**
- Consumes: `bootstrapProject`, `mountBlackboardTaskRoute`, `startBlackboardPollLoop` from
  Task 2's `./blackboard-bridge.js`; the file's own existing `emitToApp` function.

- [ ] **Step 1: Add the wiring**

In `packages/relay/src/server.ts`, add the import near the other local imports (after the
`mountChatRoute, mountChatConfigRoute` import on line 28):

```ts
import { bootstrapProject, mountBlackboardTaskRoute, startBlackboardPollLoop } from './blackboard-bridge.js';
```

Right after the existing `if (ENABLE_CHAT) { ... }` block (currently lines 296-299, ending
`mountChatConfigRoute(app, {...}); }`), add:

```ts
// Todo <-> Blackboard enrichment (see docs/superpowers/specs/2026-07-23-todo-blackboard-enrichment-design.md).
// Off by default — same "unset env means the feature is inert" convention LLM_BASE_URL uses above.
const BLACKBOARD_URL = process.env.BLACKBOARD_URL;
if (BLACKBOARD_URL) {
  const blackboardCfg = { baseUrl: BLACKBOARD_URL, apiKey: process.env.BLACKBOARD_API_KEY ?? 'dev-key' };
  bootstrapProject(blackboardCfg, 'todo-app')
    .then(({ blackboardId }) => {
      console.log(`[embinder] blackboard bootstrapped: blackboardId=${blackboardId}`);
      const deps = { cfg: blackboardCfg, blackboardId, emit: emitToApp };
      mountBlackboardTaskRoute(app, deps);
      startBlackboardPollLoop(deps);
    })
    .catch((error) => {
      console.warn('[embinder] blackboard bootstrap failed — enrichment feature stays off:', error);
    });
}
```

This must be placed after `const app = express(); app.use(express.json());` (already present
earlier in the file, line 257-258) since `mountBlackboardTaskRoute` needs `app` — placing it
after the chat block (which runs after those lines) satisfies that ordering.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @embinder/relay`
Expected: exit 0.

- [ ] **Step 3: Manual smoke check (no real blackboard-server needed for this step)**

Run: `BLACKBOARD_URL= npm run dev -w @embinder/relay` (explicitly empty/unset) for a few
seconds, confirm the relay starts normally with no blackboard-related log lines and no crash
(feature inert). Stop it (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add packages/relay/src/server.ts
git commit -m "feat(relay): wire blackboard bootstrap/route/poll-loop into server startup"
```

---

### Task 4: `@embinder/react` — generic `app-event` passthrough

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/src/provider.test.ts` (check if this file exists first — if the
  provider's ws-shim already has a test file with a different name, add to that one instead;
  search `packages/react/src` for existing provider tests before creating a new file)

**Interfaces:**
- Produces:
  ```ts
  export interface AppEventMessage { name: string; [key: string]: unknown; }
  export function subscribeEmbinderAppEvent(listener: (event: AppEventMessage) => void): () => void
  ```
  Mirrors the existing `emitEmbinderPhase`/`subscribeEmbinderPhase` pair exactly (same
  `CustomEvent` + `window.addEventListener`/`removeEventListener` shape), but for messages
  arriving over the ws (not the "direct bridge" phases those two already handle).

- [ ] **Step 1: Write the failing test**

Add to `packages/react/src/provider.test.ts` (or the existing provider test file found in
Step 0 above — adapt the import path accordingly, the exports themselves don't change):

```ts
import { describe, it, expect, vi } from 'vitest';
import { subscribeEmbinderAppEvent } from './provider.js';

describe('subscribeEmbinderAppEvent', () => {
  it('receives a window CustomEvent dispatched under the embinder:app-event name', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEmbinderAppEvent(listener);
    window.dispatchEvent(
      new CustomEvent('embinder:app-event', { detail: { name: 'blackboard-enrich-result', todoTaskId: 't1', result: { priority: 'high' } } }),
    );
    expect(listener).toHaveBeenCalledWith({ name: 'blackboard-enrich-result', todoTaskId: 't1', result: { priority: 'high' } });
    unsubscribe();
    window.dispatchEvent(new CustomEvent('embinder:app-event', { detail: { name: 'ignored-after-unsubscribe' } }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @embinder/react -- provider.test.ts`
Expected: FAIL — `subscribeEmbinderAppEvent` is not exported from `./provider.js`.

- [ ] **Step 3: Implement**

In `packages/react/src/provider.tsx`, add right after the existing
`subscribeEmbinderPhase` function (currently lines 39-46):

```ts
const APP_EVENT = 'embinder:app-event';

export interface AppEventMessage {
  name: string;
  [key: string]: unknown;
}

/** Subscribe to relay-pushed app-level events (e.g. blackboard enrichment results) that aren't
 * one of the built-in visualization phase types. @embinder/react forwards these unmodified —
 * it doesn't interpret `name` or any other field; that's entirely up to the subscribing app. */
export function subscribeEmbinderAppEvent(listener: (event: AppEventMessage) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<AppEventMessage>).detail;
    if (detail && typeof detail.name === 'string') listener(detail);
  };
  window.addEventListener(APP_EVENT, onEvent);
  return () => window.removeEventListener(APP_EVENT, onEvent);
}
```

Then modify the ws shim's message handler (currently lines 124-142) to dispatch unrecognized
message types as this event instead of silently dropping them. Change:

```ts
    next.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      // T-K: forward display-only phase events to the spotlight.
      if (PHASE_TYPES.has(m.type)) {
        phaseListener?.(m);
        return;
      }
      if (m.type !== 'call') return;
```

to:

```ts
    next.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      // T-K: forward display-only phase events to the spotlight.
      if (PHASE_TYPES.has(m.type)) {
        phaseListener?.(m);
        return;
      }
      // Generic passthrough for app-level events the relay pushes (e.g. blackboard enrichment
      // results) — @embinder/react doesn't interpret these, it just forwards them.
      if (m.type === 'app-event') {
        window.dispatchEvent(new CustomEvent(APP_EVENT, { detail: m }));
        return;
      }
      if (m.type !== 'call') return;
```

Note: the relay's `emitToApp('app-event', { name, ... })` call (Task 2/3) sends
`{ type: 'app-event', name, ... }` over the wire — `m` here already has `type: 'app-event'`
alongside `name`/`todoTaskId`/`result`, so `m` itself is a valid `AppEventMessage` (it has a
`name` field) and can be dispatched as the event detail directly, matching the test in Step 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @embinder/react -- provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full react suite to confirm no regression**

Run: `npm run test -w @embinder/react`
Expected: PASS, same total count as before plus the one new test.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/src/provider.test.ts
git commit -m "feat(react): add generic app-event passthrough to the relay ws shim"
```

---

### Task 5: `apps/todo` — notify-on-add + apply enrichment results

**Files:**
- Modify: `apps/todo/src/App.tsx`
- Test: `apps/todo/src/App.test.tsx` (create if no test file exists for `App.tsx` today — check
  `apps/todo/src` for an existing `App.test.tsx` first)

**Interfaces:**
- Consumes: `subscribeEmbinderAppEvent` from `@embinder/react` (Task 4); `Action`, `Task`,
  `Priority` types from `./store.js`.
- Produces: no new exports (this is App-internal wiring) — but the shape of `dispatchAndNotify`
  matters for anyone reading the diff: `dispatchAndNotify(action: Action, opts?: { skipNotify?: boolean }): void`.

- [ ] **Step 1: Write the failing test**

Create `apps/todo/src/App.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App blackboard notify', () => {
  it('POSTs /blackboard-tasks when a task is added via the toolbar', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, taskId: 'task-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<App />);

    const input = screen.getByPlaceholderText(/add a task/i);
    await userEvent.type(input, 'buy milk{enter}');

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(([url]) => String(url).includes('/blackboard-tasks'));
      expect(call).toBeDefined();
    });
    const [, init] = fetchSpy.mock.calls.find(([url]) => String(url).includes('/blackboard-tasks'))!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ text: 'buy milk' });
  });

  it('applies an enrichment result to the matching card without a second /blackboard-tasks POST', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, taskId: 'task-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<App />);

    const input = screen.getByPlaceholderText(/add a task/i);
    await userEvent.type(input, 'buy milk{enter}');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const card = await screen.findByText('buy milk');
    const taskId = card.closest('[data-task-id]')?.getAttribute('data-task-id');
    expect(taskId).toBeTruthy();

    fetchSpy.mockClear();
    window.dispatchEvent(
      new CustomEvent('embinder:app-event', {
        detail: { name: 'blackboard-enrich-result', todoTaskId: taskId, result: { priority: 'urgent', subtasks: ['buy oat milk'] } },
      }),
    );

    await waitFor(() => expect(screen.getByText('buy oat milk')).toBeInTheDocument());
    // The synthetic subtask card must NOT itself trigger a /blackboard-tasks POST.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

(If `TaskCard` doesn't currently render a `data-task-id` attribute, note this as a
`NEEDS_CONTEXT`/blocked concern rather than guessing — Task 5's implementer should check
`apps/todo/src/components/TaskCard.tsx` first and either confirm the attribute exists or add it
as a one-line addition, since the test needs a stable way to find a card's id in the DOM.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w todo -- App.test.tsx`
Expected: FAIL — no `/blackboard-tasks` fetch call happens yet.

- [ ] **Step 3: Implement**

In `apps/todo/src/App.tsx`, add near the top (after the existing imports):

```ts
import { subscribeEmbinderAppEvent } from '@embinder/react';
import { useEffect } from 'react';
import type { Action } from './store';
```

(Note: `useReducer`, `useRef`, `useState` are already imported from `'react'` on line 1 — add
`useEffect` to that same existing import line rather than a second `import` line.)

Add a relay base constant near the top of the file, matching the same hardcoded-default
convention `packages/react/src/chat/ChatBubble.tsx:161` already uses:

```ts
const RELAY_BASE = 'http://127.0.0.1:7331';
```

Inside the `App()` function, right after the existing `const [state, dispatch] = useReducer(reducer, initialState);` line, add:

```ts
  const dispatchAndNotify = (action: Action, opts?: { skipNotify?: boolean }) => {
    dispatch(action);
    if (action.type === 'ADD_TASK' && !opts?.skipNotify) {
      const task = action.task;
      void fetch(`${RELAY_BASE}/blackboard-tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // The reducer assigns the real id; this fire-and-forget notify doesn't know it yet,
          // so it correlates by exact text instead. Good enough for a demo feature — see the
          // spec's Non-goals for why this isn't hardened further.
          todoTaskId: task.text,
          text: task.text,
          priority: task.priority,
          tags: task.tags,
          due: task.due,
        }),
      }).catch((error) => console.warn('[todo] blackboard-tasks notify failed:', error));
    }
  };
```

Add a `useEffect` subscribing to enrichment results, right after the existing `useEmbinder({ name: 'current_screen', ... })` block:

```ts
  useEffect(() => {
    return subscribeEmbinderAppEvent((event) => {
      if (event.name === 'blackboard-enrich-result') {
        const { todoTaskId, result } = event as { todoTaskId: string; result: {
          priority?: Task['priority']; tags?: string[]; due?: string | null; subtasks?: string[];
        } };
        const target = stateRef.current.tasks.find((t) => t.text === todoTaskId);
        if (!target) return;
        if (result.priority) dispatch({ type: 'SET_PRIORITY', id: target.id, priority: result.priority });
        if (result.due !== undefined) dispatch({ type: 'SET_DUE', id: target.id, due: result.due });
        for (const tag of result.tags ?? []) dispatch({ type: 'ADD_TAG', id: target.id, tag });
        for (const subtask of result.subtasks ?? []) {
          dispatchAndNotify({ type: 'ADD_TASK', task: { text: subtask, columnId: target.columnId } }, { skipNotify: true });
        }
      }
      // 'blackboard-enrich-failed' is intentionally a no-op on the card today — logged only.
      if (event.name === 'blackboard-enrich-failed') {
        console.warn('[todo] enrichment failed:', event.reason);
      }
    });
  }, []);
```

Add the `Task` type to the existing `import { reducer, initialState, ... } from './store';` line
(needed for the inline type annotation above):

```ts
import {
  reducer,
  initialState,
  visibleTasks,
  boardStats,
  type Page,
  type ViewMode,
  type Task,
} from './store';
```

Finally, replace every `dispatch={dispatch}` prop passed to `Toolbar`, `Board`, `ListView`,
`CalendarView`, `Archive`, and `Settings` (currently lines 111, 113-115, 120-121) with
`dispatch={dispatchAndNotify}`, so every `ADD_TASK` from any child component — not just this
file — goes through the notify wrapper. The child components' own prop types accept
`dispatch: (a: Action) => void`; `dispatchAndNotify`'s second parameter is optional, so it's
assignable as-is with no type changes needed in the child components.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w todo -- App.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 5: Run the full todo suite to confirm no regression**

Run: `npm run test -w todo` (check `apps/todo/package.json`'s actual `test` script name first —
if none exists yet, this is the first test file for `apps/todo` and `vitest` config/deps need
adding; report as a concern in the implementer's self-review rather than silently inventing a
test setup the plan didn't specify)

- [ ] **Step 6: Commit**

```bash
git add apps/todo/src/App.tsx apps/todo/src/App.test.tsx
git commit -m "feat(todo): notify blackboard on task add, apply enrichment results live"
```

---

### Task 6: `scripts/todo-worker.mjs` — the Worker Agent process

**Files:**
- Create: `scripts/todo-worker.mjs`

**Interfaces:**
- Consumes: `defineWorkerAgent` from `@minder/worker-agent-sdk`; `defineLLMHandler` from the
  same package (Task 2 of last session's plan); `bootstrapProject` from
  `@embinder/relay/blackboard` — this requires adding a second subpath export to
  `packages/relay/package.json`, alongside the existing `"./chat"` one added last session:
  ```json
  "exports": {
    ".": "./dist/server.js",
    "./chat": "./src/chat.ts",
    "./blackboard": "./src/blackboard-bridge.ts"
  }
  ```

- [ ] **Step 1: Add the new relay export**

Modify `packages/relay/package.json`'s existing `"exports"` field (added last session) to
include the new `"./blackboard"` entry shown above.

- [ ] **Step 2: Write `scripts/todo-worker.mjs`**

```js
// Worker Agent process for apps/todo's automatic enrichment feature.
//   npm run dev  (spawned automatically alongside relay + todo, see scripts/dev.mjs)
// Independently bootstraps the same "todo-app" project+blackboard the relay bootstraps —
// see blackboard-bridge.ts's bootstrapProject() doc comment for why calling this from two
// processes at startup is safe (idempotent by name, with a documented cold-start race).
import { defineWorkerAgent, defineLLMHandler } from '@minder/worker-agent-sdk';
import { bootstrapProject } from '@embinder/relay/blackboard';
import { z } from 'zod';

const BLACKBOARD_URL = process.env.BLACKBOARD_URL;
const BLACKBOARD_API_KEY = process.env.BLACKBOARD_API_KEY ?? 'dev-key';
const RETRY_MS = 5000;

async function main() {
  if (!BLACKBOARD_URL) {
    console.log('[todo-worker] BLACKBOARD_URL not set — enrichment worker stays idle.');
    return;
  }

  const cfg = { baseUrl: BLACKBOARD_URL, apiKey: BLACKBOARD_API_KEY };
  let blackboardId;
  while (!blackboardId) {
    try {
      ({ blackboardId } = await bootstrapProject(cfg, 'todo-app'));
    } catch (error) {
      console.warn(`[todo-worker] bootstrap failed, retrying in ${RETRY_MS}ms:`, error.message);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
  console.log(`[todo-worker] bootstrapped, blackboardId=${blackboardId}`);

  const worker = defineWorkerAgent({
    name: 'todo-enrich-worker-1',
    capabilities: ['todo-enrich'],
    baseUrl: BLACKBOARD_URL,
    apiKey: BLACKBOARD_API_KEY,
    blackboardId,
  });

  worker.handle(
    'todo-enrich',
    defineLLMHandler({
      system:
        'You enrich a todo item. Given its text, suggest a priority, up to 3 tags, an ISO ' +
        'due date if one is implied, and up to 3 concrete subtasks if the item is complex ' +
        'enough to warrant breaking down. Leave fields out if you are not confident.',
      tools: {},
      resultSchema: z.object({
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        tags: z.array(z.string()).max(3).optional(),
        due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        subtasks: z.array(z.string()).max(3).optional(),
      }),
    }),
  );

  await worker.run({
    leaseSeconds: 300,
    pollIntervalMs: 2000,
    onError: (error) => console.error('[todo-worker] claim error:', error),
  });
}

main().catch((error) => {
  console.error('[todo-worker] fatal:', error);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Typecheck the relay's new export resolves**

Run: `npm run typecheck -w @minder/worker-agent-sdk` (this package already depends on
`@embinder/relay` since last session — no new dependency needed here, `scripts/todo-worker.mjs`
itself is a plain `.mjs` script run via `tsx`/Node directly, not typechecked as part of a
workspace package, so this step is really confirming `@embinder/relay/blackboard`'s new export
doesn't break anything the worker-agent-sdk package already imports from `@embinder/relay/chat`)
Expected: exit 0.

- [ ] **Step 4: Manual smoke check**

With a real `cargo run -p blackboard-server` running in the sibling `agent-blackboard` checkout
(`/Users/anlnm/Desktop/Project/agent-blackboard`) on its default port 8080:

```bash
BLACKBOARD_URL=http://127.0.0.1:8080 BLACKBOARD_API_KEY=dev-key node --import tsx scripts/todo-worker.mjs
```

Expected output: `[todo-worker] bootstrapped, blackboardId=<uuid>` followed by no crashes (it
will sit polling with no tasks yet, since nothing has created one). Stop with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add packages/relay/package.json scripts/todo-worker.mjs
git commit -m "feat: add todo-worker.mjs, the enrichment Worker Agent process"
```

---

### Task 7: Wire `todo-worker.mjs` into `npm run dev`

**Files:**
- Modify: `scripts/dev.mjs`

- [ ] **Step 1: Add the third process**

In `scripts/dev.mjs`, add a third entry to the `procs` array (currently lines 8-11):

```js
const procs = [
  { name: 'relay', color: '\x1b[36m', cmd: 'npm', args: ['run', 'dev', '-w', '@embinder/relay'] },
  { name: 'todo ', color: '\x1b[35m', cmd: 'npm', args: ['run', 'dev', '-w', 'todo'] },
  { name: 'worker', color: '\x1b[33m', cmd: 'node', args: ['--import', 'tsx', 'scripts/todo-worker.mjs'] },
];
```

- [ ] **Step 2: Update the final console.log line**

Change the summary line (currently line 42) to mention the worker process:

```js
console.log('\x1b[32m[embinder]\x1b[0m relay → http://127.0.0.1:7331  ·  todo → http://localhost:5173  ·  worker → BLACKBOARD_URL-gated  ·  approvals → on screen in the app tab');
```

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev` (from repo root, no `BLACKBOARD_URL` set)
Expected: three prefixed process streams start (`[relay]`, `[todo ]`, `[worker]`); the worker
process logs `[todo-worker] BLACKBOARD_URL not set — enrichment worker stays idle.` and exits
cleanly (not a crash-loop); relay and todo behave exactly as before. Stop with Ctrl-C, confirm
all three processes terminate (no orphaned ports).

- [ ] **Step 4: Commit**

```bash
git add scripts/dev.mjs
git commit -m "feat: start todo-worker.mjs alongside relay+todo in npm run dev"
```

---

### Task 8: Whole-repo verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exit 0 across `@embinder/react`, `@embinder/relay`, `@minder/worker-agent-sdk`, and
`apps/todo` (todo's own `tsc -b` build step, per its `package.json`'s `build` script — if
`apps/todo` has no standalone `typecheck` script, run `npm run build -w todo` instead and
confirm it's a type-clean build).

- [ ] **Step 2: Test**

Run: `npm run test`
Expected: all suites green, including the new `blackboard-client.test.ts`,
`blackboard-bridge.test.ts`, `provider.test.ts` additions, and `apps/todo`'s new
`App.test.tsx` (confirm `apps/todo`'s `package.json` has a `test` script wired to run it — if
not, that's a gap from Task 5 to fix, not something to paper over here).

- [ ] **Step 3: `npm run dev` smoke test, feature off**

Run: `npm run dev` with `BLACKBOARD_URL` unset. Confirm no crashes across all three processes,
todo app loads at `:5173` and behaves identically to before this plan (add a task, confirm it
appears — no visible change since the feature is inert).

- [ ] **Step 4: Record evidence**

Add a "Status at time of writing" section to the bottom of this plan file with the exact
commands run and their real output (pass/fail counts, exit codes), per this repo's `CLAUDE.md`
"Definition of done" rule. Commit that update:

```bash
git add docs/superpowers/plans/2026-07-23-todo-blackboard-enrichment-plan.md
git commit -m "docs: record todo-blackboard-enrichment verification evidence"
```

## Status at time of writing

- `node --import tsx scripts/todo-worker.mjs` -> `[todo-worker] BLACKBOARD_URL not set — enrichment worker stays idle.`
- `npm run test` -> React 17 files/54 tests, relay 7 files/25 tests, worker SDK 2 files/14 tests, Todo 1 file/1 test: PASS.
- `npm run typecheck` -> exit 0 across all workspaces.
- `npm run e2e` -> `E2E + GATE GREEN`.
- Still required: run `agent-blackboard` plus a configured LLM endpoint and verify in the served Todo browser that a completed blackboard task enriches the matching card. This was not run in this workspace because those external prerequisites were unavailable.
