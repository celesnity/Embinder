import { useReducer, useRef, useState } from 'react';
import { z } from 'zod';
import { useWebMCP, minderAnchor } from '@minder/react';
import { reducer, initialTasks, type Task } from './store';
import './App.css';

export default function App() {
  const [tasks, dispatch] = useReducer(reducer, initialTasks);
  const [draft, setDraft] = useState('');

  // Latest tasks in a ref so tool handlers read current state without re-registering.
  const tasksRef = useRef<Task[]>(tasks);
  tasksRef.current = tasks;

  // ---- tools declared as WebMCP actions (T-B2) ------------------------------
  useWebMCP({
    name: 'list_tasks',
    description: 'List all tasks with their id, text, and done status',
    inputSchema: {},
    annotations: { title: 'List tasks', readOnlyHint: true },
    handler: async () => ({ tasks: tasksRef.current }),
  });

  useWebMCP({
    name: 'add_task',
    description: 'Add a new task to the board',
    inputSchema: { text: z.string().describe('Task text') },
    annotations: { title: 'Add task' },
    handler: async ({ text }: { text: string }) => {
      dispatch({ type: 'ADD', text });
      return { ok: true, added: text };
    },
  });

  useWebMCP({
    name: 'toggle_task',
    description: 'Toggle a task done/undone by id',
    inputSchema: { id: z.string() },
    annotations: { title: 'Toggle task' },
    handler: async ({ id }: { id: string }) => {
      dispatch({ type: 'TOGGLE', id });
      return { ok: true, id };
    },
  });

  useWebMCP({
    name: 'edit_task',
    description: 'Edit the text of a task by id',
    inputSchema: { id: z.string(), text: z.string() },
    annotations: { title: 'Edit task' },
    handler: async ({ id, text }: { id: string; text: string }) => {
      dispatch({ type: 'EDIT', id, text });
      return { ok: true, id, text };
    },
  });

  useWebMCP({
    name: 'delete_task',
    description: 'Delete a single task by id',
    inputSchema: { id: z.string() },
    annotations: { title: 'Delete task', destructiveHint: true },
    handler: async ({ id }: { id: string }) => {
      dispatch({ type: 'DELETE', id });
      return { ok: true, id };
    },
  });

  useWebMCP({
    name: 'delete_all_tasks',
    description: 'Delete every task on the board',
    inputSchema: {},
    annotations: { title: 'Clear board', destructiveHint: true },
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
    <main className="board">
      <h1>Minder Todo</h1>
      <p className="hint">Reference app · tools exposed via WebMCP → relay gate</p>

      <div className="row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="New task…"
        />
        <button {...minderAnchor('add_task')} onClick={add}>Add</button>
        <button className="danger" {...minderAnchor('delete_all_tasks')} onClick={() => dispatch({ type: 'CLEAR' })}>
          Clear all
        </button>
      </div>

      <ul className="list">
        {tasks.map((t) => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <input type="checkbox" checked={t.done} onChange={() => dispatch({ type: 'TOGGLE', id: t.id })} />
            <span>{t.text}</span>
            <code>{t.id}</code>
            <button className="x" {...minderAnchor('delete_task')} onClick={() => dispatch({ type: 'DELETE', id: t.id })}>
              ✕
            </button>
          </li>
        ))}
        {tasks.length === 0 && <li className="empty">No tasks</li>}
      </ul>
    </main>
  );
}
