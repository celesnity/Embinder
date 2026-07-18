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
  | { type: 'CLEAR' };

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
    default:
      return state;
  }
}

export const initialTasks: Task[] = [
  { id: 't_seed_0', text: 'Try the Embinder gate demo', done: false },
];
