// The single source of truth for the reference todo app. Everything the UI components and
// the WebMCP tool layer (tools.ts) import comes from here: the domain types, the reducer,
// derived selectors, and the seed data. Kept framework-agnostic — no React in this file.

// ---- Domain types -----------------------------------------------------------

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ViewMode = 'board' | 'list' | 'calendar';
export type StatusFilter = 'all' | 'active' | 'done';
export type Page = 'board' | 'analytics' | 'archive' | 'settings';
export type SortKey = 'priority' | 'due' | 'created';

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
// Several components refer to the column type as `Col` — keep the alias so they compile as-is.
export type Col = Column;

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
  past: State[];
}

// ---- Constants --------------------------------------------------------------

export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low'];

export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 3,
  high: 2,
  medium: 1,
  low: 0,
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const PRIO_COLOR: Record<Priority, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#2563eb',
  low: '#64748b',
};

export const PAGES: Page[] = ['board', 'analytics', 'archive', 'settings'];

export const VIEWS: ViewMode[] = ['board', 'list', 'calendar'];

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ---- Actions ----------------------------------------------------------------

export type Action =
  | { type: 'ADD_TASK'; task: Partial<Task> & { text: string; columnId?: string } }
  | { type: 'EDIT_TASK'; id: string; patch: Partial<Task> }
  | { type: 'DELETE_TASK'; id: string }
  | { type: 'TOGGLE_TASK'; id: string }
  | { type: 'MOVE_TASK'; id: string; columnId: string; position?: number }
  | { type: 'SET_PRIORITY'; id: string; priority: Priority }
  | { type: 'SET_DUE'; id: string; due: string | null }
  | { type: 'ASSIGN'; id: string; assignee: string | null }
  | { type: 'ADD_TAG'; id: string; tag: string }
  | { type: 'REMOVE_TAG'; id: string; tag: string }
  | { type: 'ADD_COLUMN'; title: string }
  | { type: 'RENAME_COLUMN'; id: string; title: string }
  | { type: 'DELETE_COLUMN'; id: string }
  | { type: 'SET_VIEW'; view: ViewMode }
  | { type: 'SET_ROUTE'; route: Page }
  | { type: 'SET_FILTER'; patch: Partial<Filter> }
  | { type: 'CLEAR_FILTER' }
  | { type: 'UNDO' }
  | { type: 'MARK_ALL_DONE'; columnId?: string }
  | { type: 'CLEAR_COMPLETED' }
  | { type: 'ARCHIVE_DONE' }
  | { type: 'BULK_DELETE'; ids: string[] }
  | { type: 'DELETE_ALL' }
  | { type: 'IMPORT'; tasks: Task[]; columns: Column[] };

// Non-mutating actions never push an undo snapshot (view/route/filter/undo itself).
const NON_MUTATING = new Set<Action['type']>([
  'SET_VIEW',
  'SET_ROUTE',
  'SET_FILTER',
  'CLEAR_FILTER',
  'UNDO',
]);

// ---- Factories / seed -------------------------------------------------------

export function emptyFilter(): Filter {
  return { search: '', tag: null, priority: null, assignee: null, status: 'all' };
}

export const initialColumns: Column[] = [
  { id: 'backlog', title: 'Backlog', order: 0 },
  { id: 'todo', title: 'To do', order: 1 },
  { id: 'doing', title: 'Doing', order: 2 },
  { id: 'done', title: 'Done', order: 3 },
];

let idSeq = 0;
const nextId = () => `t${(++idSeq).toString(36)}${Date.now().toString(36).slice(-3)}`;

const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

type Seed = Omit<Task, 'id' | 'notes' | 'order' | 'archived' | 'createdAt'> &
  Partial<Pick<Task, 'notes' | 'archived'>>;

const seeds: Seed[] = [
  { text: 'Design the approval gate flow', done: false, priority: 'urgent', tags: ['design', 'gate'], due: day(-1), assignee: 'Ana', columnId: 'doing' },
  { text: 'Wire spotlight to grabAnchor', done: false, priority: 'high', tags: ['spotlight'], due: day(2), assignee: 'Ben', columnId: 'doing' },
  { text: 'Write the WebMCP tool map', done: false, priority: 'high', tags: ['sdk'], due: day(4), assignee: 'Ana', columnId: 'todo' },
  { text: 'Draft the analytics page', done: false, priority: 'medium', tags: ['design', 'analytics'], due: null, assignee: null, columnId: 'todo' },
  { text: 'Explore calendar drag targets', done: false, priority: 'low', tags: ['calendar'], due: day(7), assignee: 'Cy', columnId: 'backlog' },
  { text: 'Collect demo feedback', done: false, priority: 'medium', tags: ['demo'], due: null, assignee: 'Ben', columnId: 'backlog' },
  { text: 'Ship the relay MCP server', done: true, priority: 'high', tags: ['sdk', 'relay'], due: day(-3), assignee: 'Ana', columnId: 'done' },
  { text: 'Set up the todo workspace', done: true, priority: 'medium', tags: ['setup'], due: day(-5), assignee: 'Cy', columnId: 'done' },
  { text: 'Prototype the chat bubble', done: true, priority: 'low', tags: ['chat'], due: day(-6), assignee: 'Ben', columnId: 'done' },
  { text: 'Retire the old two-page app', done: true, priority: 'low', tags: ['cleanup'], due: day(-8), assignee: 'Ana', columnId: 'done', archived: true },
];

function seedTasks(): Task[] {
  const perColumn = new Map<string, number>();
  return seeds.map((s, i) => {
    const order = perColumn.get(s.columnId) ?? 0;
    perColumn.set(s.columnId, order + 1);
    return {
      id: nextId(),
      text: s.text,
      notes: s.notes ?? '',
      done: s.done,
      priority: s.priority,
      tags: s.tags,
      due: s.due,
      assignee: s.assignee,
      columnId: s.columnId,
      order,
      archived: s.archived ?? false,
      createdAt: Date.now() - (seeds.length - i) * 60_000,
    };
  });
}

export const initialState: State = {
  tasks: seedTasks(),
  columns: initialColumns,
  view: 'board',
  route: 'board',
  filter: emptyFilter(),
  past: [],
};

// ---- Selectors --------------------------------------------------------------

/** Tasks visible under the active filter (archived tasks are always excluded). */
export function visibleTasks(state: State): Task[] {
  const f = state.filter;
  const q = f.search.trim().toLowerCase();
  return state.tasks.filter((t) => {
    if (t.archived) return false;
    if (f.status === 'active' && t.done) return false;
    if (f.status === 'done' && !t.done) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.tag && !t.tags.includes(f.tag)) return false;
    if (f.assignee && t.assignee !== f.assignee) return false;
    if (q && !t.text.toLowerCase().includes(q) && !t.notes.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Filtered tasks within one column, ordered by their in-column slot. */
export function tasksInColumn(state: State, columnId: string): Task[] {
  return visibleTasks(state)
    .filter((t) => t.columnId === columnId)
    .sort((a, b) => a.order - b.order);
}

export function allTags(state: State): string[] {
  const set = new Set<string>();
  for (const t of state.tasks) {
    if (t.archived) continue;
    for (const tag of t.tags) set.add(tag);
  }
  return [...set].sort();
}

export function allAssignees(state: State): string[] {
  const set = new Set<string>();
  for (const t of state.tasks) {
    if (t.archived) continue;
    if (t.assignee) set.add(t.assignee);
  }
  return [...set].sort();
}

export interface BoardStats {
  total: number;
  active: number;
  done: number;
  overdue: number;
  archived: number;
  tags: number;
  byPriority: Record<Priority, number>;
  byColumn: Record<string, number>;
}

export function boardStats(state: State): BoardStats {
  const today = new Date().toISOString().slice(0, 10);
  const byPriority: Record<Priority, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
  const byColumn: Record<string, number> = {};
  for (const c of state.columns) byColumn[c.id] = 0;

  let total = 0;
  let done = 0;
  let overdue = 0;
  let archived = 0;
  for (const t of state.tasks) {
    if (t.archived) {
      archived++;
      continue;
    }
    total++;
    if (t.done) done++;
    if (!t.done && t.due && t.due < today) overdue++;
    byPriority[t.priority]++;
    byColumn[t.columnId] = (byColumn[t.columnId] ?? 0) + 1;
  }
  return {
    total,
    active: total - done,
    done,
    overdue,
    archived,
    tags: allTags(state).length,
    byPriority,
    byColumn,
  };
}

// ---- Reducer ----------------------------------------------------------------

const patchTask = (state: State, id: string, fn: (t: Task) => Task): Task[] =>
  state.tasks.map((t) => (t.id === id ? fn(t) : t));

function apply(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_TASK': {
      const columnId = action.task.columnId ?? state.columns[0]?.id ?? 'backlog';
      const order = state.tasks.filter((t) => t.columnId === columnId).length;
      const task: Task = {
        id: nextId(),
        text: action.task.text,
        notes: action.task.notes ?? '',
        done: action.task.done ?? false,
        priority: action.task.priority ?? 'medium',
        tags: action.task.tags ?? [],
        due: action.task.due ?? null,
        assignee: action.task.assignee ?? null,
        columnId,
        order,
        archived: action.task.archived ?? false,
        createdAt: Date.now(),
      };
      return { ...state, tasks: [...state.tasks, task] };
    }

    case 'EDIT_TASK':
      return { ...state, tasks: patchTask(state, action.id, (t) => ({ ...t, ...action.patch })) };

    case 'DELETE_TASK':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };

    case 'TOGGLE_TASK':
      return { ...state, tasks: patchTask(state, action.id, (t) => ({ ...t, done: !t.done })) };

    case 'MOVE_TASK': {
      const moving = state.tasks.find((t) => t.id === action.id);
      if (!moving) return state;
      const target = state.tasks
        .filter((t) => t.columnId === action.columnId && t.id !== action.id)
        .sort((a, b) => a.order - b.order);
      const pos = action.position === undefined
        ? target.length
        : Math.max(0, Math.min(action.position, target.length));
      target.splice(pos, 0, { ...moving, columnId: action.columnId });
      const reordered = new Map(target.map((t, i) => [t.id, i]));
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.id === action.id) return { ...t, columnId: action.columnId, order: pos };
          if (reordered.has(t.id)) return { ...t, order: reordered.get(t.id)! };
          return t;
        }),
      };
    }

    case 'SET_PRIORITY':
      return { ...state, tasks: patchTask(state, action.id, (t) => ({ ...t, priority: action.priority })) };

    case 'SET_DUE':
      return { ...state, tasks: patchTask(state, action.id, (t) => ({ ...t, due: action.due })) };

    case 'ASSIGN':
      return { ...state, tasks: patchTask(state, action.id, (t) => ({ ...t, assignee: action.assignee })) };

    case 'ADD_TAG':
      return {
        ...state,
        tasks: patchTask(state, action.id, (t) =>
          t.tags.includes(action.tag) ? t : { ...t, tags: [...t.tags, action.tag] }),
      };

    case 'REMOVE_TAG':
      return {
        ...state,
        tasks: patchTask(state, action.id, (t) => ({ ...t, tags: t.tags.filter((g) => g !== action.tag) })),
      };

    case 'ADD_COLUMN': {
      const order = state.columns.length;
      const base = action.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'col';
      let id = base;
      let n = 1;
      while (state.columns.some((c) => c.id === id)) id = `${base}-${++n}`;
      return { ...state, columns: [...state.columns, { id, title: action.title, order }] };
    }

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

    case 'MARK_ALL_DONE':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          (!action.columnId || t.columnId === action.columnId) && !t.archived ? { ...t, done: true } : t),
      };

    case 'CLEAR_COMPLETED':
      return { ...state, tasks: state.tasks.filter((t) => !(t.done && !t.archived)) };

    case 'ARCHIVE_DONE':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.done && !t.archived ? { ...t, archived: true } : t)),
      };

    case 'BULK_DELETE': {
      const ids = new Set(action.ids);
      return { ...state, tasks: state.tasks.filter((t) => !ids.has(t.id)) };
    }

    case 'DELETE_ALL':
      return { ...state, tasks: [] };

    case 'IMPORT':
      return {
        ...state,
        tasks: action.tasks,
        columns: action.columns,
        filter: emptyFilter(),
      };

    case 'UNDO': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      // Restore data, but keep the current view/route/filter so undo doesn't teleport the user.
      return {
        ...prev,
        view: state.view,
        route: state.route,
        filter: state.filter,
        past: state.past.slice(0, -1),
      };
    }

    default:
      return state;
  }
}

export function reducer(state: State, action: Action): State {
  const next = apply(state, action);
  if (next === state) return state;
  if (NON_MUTATING.has(action.type)) return next;
  // Snapshot the PRE-mutation state (without its own history) so undo can restore it.
  const snapshot: State = { ...state, past: [] };
  const past = [...state.past, snapshot].slice(-50);
  return { ...next, past };
}
