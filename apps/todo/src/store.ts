// Todo state (T-A1) — useReducer so each action maps cleanly to a dispatch.

export interface Task {
  id: string;
  text: string;
  done: boolean;
}

export type Action =
  | { type: 'ADD'; text: string }
  | { type: 'TOGGLE'; id: string }
  | { type: 'EDIT'; id: string; text: string }
  | { type: 'DELETE'; id: string }
  | { type: 'CLEAR' }
  | { type: 'PURGE_DONE' };

let seq = 0;
const nextId = () => `t${Date.now().toString(36)}_${seq++}`;

export function reducer(state: Task[], action: Action): Task[] {
  switch (action.type) {
    case 'ADD':
      return [...state, { id: nextId(), text: action.text, done: false }];
    case 'TOGGLE':
      return state.map((t) => (t.id === action.id ? { ...t, done: !t.done } : t));
    case 'EDIT':
      return state.map((t) => (t.id === action.id ? { ...t, text: action.text } : t));
    case 'DELETE':
      return state.filter((t) => t.id !== action.id);
    case 'CLEAR':
      return [];
    case 'PURGE_DONE':
      return state.filter((t) => !t.done);
    default:
      return state;
  }
}

// Seed differs per page (3 open on Board, 2 done in Archive) so the agent's
// per-screen context is observably different — the whole point of the demo.
export const initialTasks: Task[] = [
  { id: 't_seed_0', text: 'Try the Embinder gate demo', done: false },
  { id: 't_seed_1', text: 'Watch the agent context switch pages', done: false },
  { id: 't_seed_2', text: 'Approve a destructive call', done: false },
  { id: 't_seed_3', text: 'Read the design doc', done: true },
  { id: 't_seed_4', text: 'Rebrand to Embinder', done: true },
];
