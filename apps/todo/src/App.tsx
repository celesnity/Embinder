import { useReducer, useRef, useState, type Dispatch } from 'react';
import { z } from 'zod';
import { useEmbinder } from '@embinder/react';
import { reducer, initialTasks, type Task, type Action } from './store';
import './App.css';

// Two pages, one store. Each page mounts its own embinder pointers, so the agent's
// context follows the screen the user is on — navigate and watch it switch.
// Navigation itself is deliberately NOT a pointer in v1 (design non-goal D-8).

function BoardPage({ tasks, dispatch }: { tasks: Task[]; dispatch: Dispatch<Action> }) {
  const [draft, setDraft] = useState('');
  const open = tasks.filter((t) => !t.done);

  const tasksRef = useRef<Task[]>(tasks);
  tasksRef.current = tasks;

  // Context-only pointer: the agent reads the board like the user does — no list_* tool.
  const boardBind = useEmbinder({
    name: 'task_board',
    description: 'The task board the user is looking at (open tasks)',
    context: () => ({ openTasks: open }),
  });

  const addBind = useEmbinder({
    name: 'add_task',
    description: 'Add a new task to the board',
    title: 'Add task',
    input: { text: z.string().describe('Task text') },
    handler: async ({ text }: { text: string }) => {
      dispatch({ type: 'ADD', text });
      return { ok: true, added: text };
    },
  });

  useEmbinder({
    name: 'toggle_task',
    description: 'Toggle a task done/undone by id',
    title: 'Toggle task',
    input: { id: z.string() },
    handler: async ({ id }: { id: string }) => {
      dispatch({ type: 'TOGGLE', id });
      return { ok: true, id };
    },
  });

  useEmbinder({
    name: 'edit_task',
    description: 'Edit the text of a task by id',
    title: 'Edit task',
    input: { id: z.string(), text: z.string() },
    handler: async ({ id, text }: { id: string; text: string }) => {
      dispatch({ type: 'EDIT', id, text });
      return { ok: true, id, text };
    },
  });

  const deleteBind = useEmbinder({
    name: 'delete_task',
    description: 'Delete a single task by id',
    title: 'Delete task',
    destructive: true,
    input: { id: z.string() },
    handler: async ({ id }: { id: string }) => {
      dispatch({ type: 'DELETE', id });
      return { ok: true, id };
    },
  });

  const clearBind = useEmbinder({
    name: 'delete_all_tasks',
    description: 'Delete every task on the board',
    title: 'Clear board',
    destructive: true,
    handler: async () => {
      const cleared = tasksRef.current.length;
      dispatch({ type: 'CLEAR' });
      return { ok: true, cleared };
    },
  });

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    dispatch({ type: 'ADD', text });
    setDraft('');
  };

  return (
    <section {...boardBind}>
      <div className="row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="New task…"
        />
        <button {...addBind} onClick={add}>Add</button>
        <button className="danger" {...clearBind} onClick={() => dispatch({ type: 'CLEAR' })}>
          Clear all
        </button>
      </div>

      <ul className="list">
        {open.map((t) => (
          <li key={t.id}>
            <input type="checkbox" checked={t.done} onChange={() => dispatch({ type: 'TOGGLE', id: t.id })} />
            <span>{t.text}</span>
            <code>{t.id}</code>
            <button className="x" {...deleteBind} onClick={() => dispatch({ type: 'DELETE', id: t.id })}>
              ✕
            </button>
          </li>
        ))}
        {open.length === 0 && <li className="empty">No open tasks</li>}
      </ul>
    </section>
  );
}

function ArchivePage({ tasks, dispatch }: { tasks: Task[]; dispatch: Dispatch<Action> }) {
  const done = tasks.filter((t) => t.done);

  const archiveBind = useEmbinder({
    name: 'archive_list',
    description: 'The archive of completed tasks the user is looking at',
    context: () => ({ doneTasks: done }),
  });

  const restoreBind = useEmbinder({
    name: 'restore_task',
    description: 'Restore a completed task back to the board by id',
    title: 'Restore task',
    input: { id: z.string() },
    handler: async ({ id }: { id: string }) => {
      dispatch({ type: 'TOGGLE', id });
      return { ok: true, restored: id };
    },
  });

  const purgeBind = useEmbinder({
    name: 'purge_archive',
    description: 'Permanently delete every completed task',
    title: 'Purge archive',
    destructive: true,
    handler: async () => {
      const purged = done.length;
      dispatch({ type: 'PURGE_DONE' });
      return { ok: true, purged };
    },
  });

  return (
    <section {...archiveBind}>
      <div className="row">
        <button className="danger" {...purgeBind} onClick={() => dispatch({ type: 'PURGE_DONE' })}>
          Purge archive
        </button>
      </div>
      <ul className="list">
        {done.map((t) => (
          <li key={t.id} className="done">
            <span>{t.text}</span>
            <code>{t.id}</code>
            <button className="x" {...restoreBind} onClick={() => dispatch({ type: 'TOGGLE', id: t.id })}>
              ↩
            </button>
          </li>
        ))}
        {done.length === 0 && <li className="empty">Archive is empty</li>}
      </ul>
    </section>
  );
}

export default function App() {
  const [tasks, dispatch] = useReducer(reducer, initialTasks);
  const [page, setPage] = useState<'board' | 'archive'>('board');

  return (
    <main className="board">
      <h1>Embinder Todo</h1>
      <p className="hint">
        The agent only knows the page you're on — its context switches when you navigate.
      </p>

      <nav className="row">
        <button disabled={page === 'board'} onClick={() => setPage('board')}>
          Board
        </button>
        <button disabled={page === 'archive'} onClick={() => setPage('archive')}>
          Archive
        </button>
      </nav>

      {page === 'board' ? (
        <BoardPage tasks={tasks} dispatch={dispatch} />
      ) : (
        <ArchivePage tasks={tasks} dispatch={dispatch} />
      )}
    </main>
  );
}
