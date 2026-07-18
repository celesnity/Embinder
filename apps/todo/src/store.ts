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
  | { type: 'ADD_TASK'; task: Partial<Task> & { text: string } }
  | { type: 'EDIT_TASK'; id: string; patch: Partial<Omit<Task, 'id'>> }
  | { type: 'TOGGLE_TASK'; id: string }
  | { type: 'SET_PRIORITY'; id: string; priority: Priority }
  | { type: 'SET_DUE'; id: string; due: string | null }
  | { type: 'ADD_TAG'; id: string; tag: string }
  | { type: 'REMOVE_TAG'; id: string; tag: string }
  | { type: 'ASSIGN'; id: string; assignee: string | null }
  | { type: 'MOVE_TASK'; id: string; columnId: string; position?: number }
  | { type: 'DELETE_TASK'; id: string }
  | { type: 'DELETE_ALL' }
  | { type: 'CLEAR_COMPLETED' }
  | { type: 'ARCHIVE_DONE' }
  | { type: 'MARK_ALL_DONE'; columnId?: string }
  | { type: 'BULK_DELETE'; ids: string[] }
  | { type: 'ADD_COLUMN'; title: string }
  | { type: 'RENAME_COLUMN'; id: string; title: string }
  | { type: 'DELETE_COLUMN'; id: string }
  | { type: 'SET_VIEW'; view: ViewMode }
  | { type: 'SET_ROUTE'; route: Page }
  | { type: 'SET_FILTER'; patch: Partial<Filter> }
  | { type: 'CLEAR_FILTER' }
  | { type: 'IMPORT'; tasks: Task[]; columns: Column[] }
  | { type: 'UNDO' };

let seq = 0;
const nextId = (p = 't') => `${p}${Date.now().toString(36)}_${seq++}`;

// Actions that don't mutate persisted board data → no undo snapshot.
const NON_MUTATING = new Set(['SET_VIEW', 'SET_ROUTE', 'SET_FILTER', 'CLEAR_FILTER', 'UNDO']);

const orderIn = (tasks: Task[], columnId: string) =>
  tasks.filter((t) => t.columnId === columnId).length;

function core(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_TASK': {
      const t = action.task;
      const columnId = t.columnId && state.columns.some((c) => c.id === t.columnId)
        ? t.columnId
        : state.columns[0]?.id ?? 'todo';
      const task: Task = {
        id: nextId(),
        text: t.text,
        notes: t.notes ?? '',
        done: t.done ?? false,
        priority: t.priority ?? 'medium',
        tags: t.tags ?? [],
        due: t.due ?? null,
        assignee: t.assignee ?? null,
        columnId,
        order: orderIn(state.tasks, columnId),
        archived: false,
        createdAt: Date.now(),
      };
      return { ...state, tasks: [...state.tasks, task] };
    }
    case 'EDIT_TASK':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      };
    case 'TOGGLE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, done: !t.done } : t)),
      };
    case 'SET_PRIORITY':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, priority: action.priority } : t)),
      };
    case 'SET_DUE':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, due: action.due } : t)),
      };
    case 'ADD_TAG':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id && !t.tags.includes(action.tag)
            ? { ...t, tags: [...t.tags, action.tag] }
            : t,
        ),
      };
    case 'REMOVE_TAG':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, tags: t.tags.filter((x) => x !== action.tag) } : t,
        ),
      };
    case 'ASSIGN':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, assignee: action.assignee } : t)),
      };
    case 'MOVE_TASK': {
      const moving = state.tasks.find((t) => t.id === action.id);
      if (!moving) return state;
      const columnId = state.columns.some((c) => c.id === action.columnId)
        ? action.columnId
        : moving.columnId;
      const rest = state.tasks.filter((t) => t.id !== action.id);
      const dest = rest.filter((t) => t.columnId === columnId).sort((a, b) => a.order - b.order);
      const pos = action.position ?? dest.length;
      dest.splice(Math.max(0, Math.min(pos, dest.length)), 0, { ...moving, columnId });
      const reordered = dest.map((t, i) => ({ ...t, columnId, order: i }));
      const others = rest.filter((t) => t.columnId !== columnId);
      return { ...state, tasks: [...others, ...reordered] };
    }
    case 'DELETE_TASK':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };
    case 'DELETE_ALL':
      return { ...state, tasks: [] };
    case 'CLEAR_COMPLETED':
      return { ...state, tasks: state.tasks.filter((t) => !t.done) };
    case 'ARCHIVE_DONE':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.done ? { ...t, archived: true } : t)),
      };
    case 'MARK_ALL_DONE':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          !action.columnId || t.columnId === action.columnId ? { ...t, done: true } : t,
        ),
      };
    case 'BULK_DELETE': {
      const kill = new Set(action.ids);
      return { ...state, tasks: state.tasks.filter((t) => !kill.has(t.id)) };
    }
    case 'ADD_COLUMN':
      return {
        ...state,
        columns: [
          ...state.columns,
          { id: nextId('c'), title: action.title, order: state.columns.length },
        ],
      };
    case 'RENAME_COLUMN':
      return {
        ...state,
        columns: state.columns.map((c) => (c.id === action.id ? { ...c, title: action.title } : c)),
      };
    case 'DELETE_COLUMN':
      return {
        ...state,
        columns: state.columns.filter((c) => c.id !== action.id),
        tasks: state.tasks.filter((t) => t.columnId !== action.id),
      };
    case 'SET_VIEW':
      return { ...state, view: action.view };
    case 'SET_ROUTE':
      return { ...state, route: action.route };
    case 'SET_FILTER':
      return { ...state, filter: { ...state.filter, ...action.patch } };
    case 'CLEAR_FILTER':
      return { ...state, filter: emptyFilter() };
    case 'IMPORT':
      return { ...state, tasks: action.tasks, columns: action.columns };
    case 'UNDO': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { ...state, tasks: prev.tasks, columns: prev.columns, past: state.past.slice(0, -1) };
    }
    default:
      return state;
  }
}

export function reducer(state: State, action: Action): State {
  const next = core(state, action);
  if (next === state || NON_MUTATING.has(action.type)) return next;
  // Snapshot the pre-mutation board for undo (cap depth at 50).
  const past = [...state.past, { tasks: state.tasks, columns: state.columns }].slice(-50);
  return { ...next, past };
}

export function emptyFilter(): Filter {
  return { search: '', tag: null, priority: null, assignee: null, status: 'all' };
}

// ---- selectors (shared by views + read tools) -------------------------------

export function visibleTasks(state: State): Task[] {
  const { search, tag, priority, assignee, status } = state.filter;
  const q = search.trim().toLowerCase();
  return state.tasks.filter((t) => {
    if (t.archived) return false;
    if (status === 'active' && t.done) return false;
    if (status === 'done' && !t.done) return false;
    if (tag && !t.tags.includes(tag)) return false;
    if (priority && t.priority !== priority) return false;
    if (assignee && t.assignee !== assignee) return false;
    if (q && !(t.text.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))) return false;
    return true;
  });
}

export function tasksInColumn(state: State, columnId: string): Task[] {
  return visibleTasks(state)
    .filter((t) => t.columnId === columnId)
    .sort((a, b) => a.order - b.order);
}

export function allTags(state: State): string[] {
  return [...new Set(state.tasks.flatMap((t) => t.tags))].sort();
}

export function allAssignees(state: State): string[] {
  return [...new Set(state.tasks.map((t) => t.assignee).filter((a): a is string => !!a))].sort();
}

export function boardStats(state: State) {
  const live = state.tasks.filter((t) => !t.archived);
  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
  const byColumn: Record<string, number> = {};
  let done = 0;
  let overdue = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const t of live) {
    byPriority[t.priority]++;
    byColumn[t.columnId] = (byColumn[t.columnId] ?? 0) + 1;
    if (t.done) done++;
    if (t.due && t.due < today && !t.done) overdue++;
  }
  return {
    total: live.length,
    done,
    active: live.length - done,
    overdue,
    archived: state.tasks.length - live.length,
    byPriority,
    byColumn,
    tags: allTags(state).length,
  };
}

// ---- seed -------------------------------------------------------------------

export const initialColumns: Column[] = [
  { id: 'backlog', title: 'Backlog', order: 0 },
  { id: 'todo', title: 'To Do', order: 1 },
  { id: 'doing', title: 'In Progress', order: 2 },
  { id: 'done', title: 'Done', order: 3 },
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
