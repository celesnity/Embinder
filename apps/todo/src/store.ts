// Kanban board state (expanded for full SDK coverage).
// useReducer so every WebMCP tool maps cleanly to a dispatch. Undo is a snapshot stack.

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ViewMode = 'board' | 'list' | 'calendar';
export type StatusFilter = 'all' | 'active' | 'done';
export type Page = 'board' | 'analytics' | 'archive' | 'settings';

export const PAGES: Page[] = ['board', 'analytics', 'archive', 'settings'];

export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 3, high: 2, medium: 1, low: 0 };

export interface Task {
  id: string;
  text: string;
  notes: string;
  done: boolean;
  priority: Priority;
  tags: string[];
  due: string | null; // ISO yyyy-mm-dd
  assignee: string | null;
  columnId: string;
  order: number;
  archived: boolean;
  createdAt: number;
}

export interface Column {
  id: string;
  title: string;
  order: number;
}

export interface Filter {
  search: string;
  tag: string | null;
  priority: Priority | null;
  assignee: string | null;
  status: StatusFilter;
}

export interface State {
  tasks: Task[];
  columns: Column[];
  view: ViewMode;
  route: Page;
  filter: Filter;
  past: Array<Pick<State, 'tasks' | 'columns'>>;
}

export type Action =
  | { type: 'ADD'; text: string }
  | { type: 'TOGGLE'; id: string }
  | { type: 'EDIT'; id: string; text: string }
  | { type: 'DELETE'; id: string }
  | { type: 'CLEAR' }
  | { type: 'PURGE_DONE' };

let seq = 0;
const nextId = (p = 't') => `${p}${Date.now().toString(36)}_${seq++}`;

// Actions that don't mutate persisted board data → no undo snapshot.
const NON_MUTATING = new Set(['SET_VIEW', 'SET_ROUTE', 'SET_FILTER', 'CLEAR_FILTER', 'UNDO']);

const orderIn = (tasks: Task[], columnId: string) =>
  tasks.filter((t) => t.columnId === columnId).length;

function core(state: State, action: Action): State {
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

const seed = (o: Partial<Task> & { text: string; columnId: string; order: number }): Task => ({
  id: nextId(),
  notes: '',
  done: false,
  priority: 'medium',
  tags: [],
  due: null,
  assignee: null,
  archived: false,
  createdAt: Date.now(),
  ...o,
});

export const initialState: State = {
  columns: initialColumns,
  view: 'board',
  route: 'board',
  filter: emptyFilter(),
  past: [],
  tasks: [
    seed({ text: 'Try the Embinder gate demo', columnId: 'doing', order: 0, priority: 'high', tags: ['demo'], assignee: 'you' }),
    seed({ text: 'Point an MCP client at :7331/mcp', columnId: 'todo', order: 0, tags: ['setup'] }),
    seed({ text: 'Ask the agent to clear the board', columnId: 'todo', order: 1, priority: 'urgent', tags: ['demo', 'gate'] }),
    seed({ text: 'Read the policy.json risk tiers', columnId: 'backlog', order: 0, priority: 'low', tags: ['docs'] }),
    seed({ text: 'Install the SDK', columnId: 'done', order: 0, done: true, tags: ['setup'], assignee: 'you' }),
  ],
};
