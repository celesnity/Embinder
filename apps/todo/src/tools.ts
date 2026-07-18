// All WebMCP tool declarations in one hook, so the agent's "map" of the app lives together.
// Risk tiers (read / write / destructive) are mirrored in ../../embinder.policy.json.

import { useWebMCP } from '@embinder/react';
import { z } from 'zod';
import {
  type Action,
  type State,
  type Task,
  PRIORITIES,
  PAGES,
  visibleTasks,
  tasksInColumn,
  allTags,
  allAssignees,
  boardStats,
  emptyFilter,
} from './store';
import { SECTIONS, sectionById } from './sections';

type Dispatch = (a: Action) => void;
type Ref = { current: State };

const priorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);
const viewEnum = z.enum(['board', 'list', 'calendar']);
const statusEnum = z.enum(['all', 'active', 'done']);
const pageEnum = z.enum(['board', 'analytics', 'archive', 'settings']);

// Scroll an anchor into view once the target page has rendered.
function scrollAfterRender(id: string) {
  const go = (tries: number) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('nav-flash');
      setTimeout(() => el.classList.remove('nav-flash'), 1400);
    } else if (tries > 0) {
      setTimeout(() => go(tries - 1), 50);
    }
  };
  setTimeout(() => go(6), 40);
}
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date, e.g. 2026-07-31')
  .describe('Due date in ISO format yyyy-mm-dd');

const slim = (t: Task) => ({
  id: t.id,
  text: t.text,
  done: t.done,
  priority: t.priority,
  tags: t.tags,
  due: t.due,
  assignee: t.assignee,
  column: t.columnId,
});

const find = (s: State, id: string) => s.tasks.find((t) => t.id === id);

export function useBoardTools(ref: Ref, dispatch: Dispatch) {
  // ---- READ -----------------------------------------------------------------
  useWebMCP({
    name: 'list_tasks',
    description: 'List tasks honoring the active filter. Optionally scope to one column.',
    inputSchema: { column: z.string().optional().describe('Column id to scope to') },
    annotations: { title: 'List tasks', readOnlyHint: true },
    handler: async ({ column }: { column?: string }) => {
      const s = ref.current;
      const tasks = (column ? tasksInColumn(s, column) : visibleTasks(s)).map(slim);
      return { count: tasks.length, tasks };
    },
  });

  useWebMCP({
    name: 'get_task',
    description: 'Get one task with all fields (notes, tags, due, assignee) by id',
    inputSchema: { id: z.string() },
    annotations: { title: 'Get task', readOnlyHint: true },
    handler: async ({ id }: { id: string }) => {
      const t = find(ref.current, id);
      return t ? { task: t } : { error: 'not_found', id };
    },
  });

  useWebMCP({
    name: 'search_tasks',
    description: 'Full-text search across task text and notes (ignores the active filter)',
    inputSchema: { query: z.string().describe('Text to search for') },
    annotations: { title: 'Search tasks', readOnlyHint: true },
    handler: async ({ query }: { query: string }) => {
      const q = query.trim().toLowerCase();
      const tasks = ref.current.tasks
        .filter((t) => !t.archived && (t.text.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)))
        .map(slim);
      return { count: tasks.length, tasks };
    },
  });

  useWebMCP({
    name: 'list_columns',
    description: 'List board columns (lanes) with id, title, and live task counts',
    inputSchema: {},
    annotations: { title: 'List columns', readOnlyHint: true },
    handler: async () => {
      const s = ref.current;
      return {
        columns: [...s.columns]
          .sort((a, b) => a.order - b.order)
          .map((c) => ({ id: c.id, title: c.title, tasks: tasksInColumn(s, c.id).length })),
      };
    },
  });

  useWebMCP({
    name: 'list_tags',
    description: 'List every distinct tag and assignee currently used on the board',
    inputSchema: {},
    annotations: { title: 'List tags', readOnlyHint: true },
    handler: async () => ({ tags: allTags(ref.current), assignees: allAssignees(ref.current) }),
  });

  useWebMCP({
    name: 'board_stats',
    description: 'Aggregate board stats: totals, done/active/overdue counts, breakdown by priority and column',
    inputSchema: {},
    annotations: { title: 'Board stats', readOnlyHint: true },
    handler: async () => boardStats(ref.current),
  });

  useWebMCP({
    name: 'get_view',
    description: 'Get the current view mode (board/list/calendar) and active filter',
    inputSchema: {},
    annotations: { title: 'Get view', readOnlyHint: true },
    handler: async () => ({ view: ref.current.view, filter: ref.current.filter }),
  });

  useWebMCP({
    name: 'list_pages',
    description: 'List the app pages and the named sections on each that you can scroll the user to',
    inputSchema: {},
    annotations: { title: 'List pages', readOnlyHint: true },
    handler: async () => ({
      pages: PAGES,
      sections: SECTIONS.map((s) => ({ id: s.id, page: s.page, title: s.title })),
    }),
  });

  useWebMCP({
    name: 'where_am_i',
    description: 'Report the page the user is currently on and the active board view',
    inputSchema: {},
    annotations: { title: 'Where am I', readOnlyHint: true },
    handler: async () => ({ page: ref.current.route, view: ref.current.view }),
  });

  useWebMCP({
    name: 'export_board',
    description: 'Export the entire board (tasks + columns) as JSON for backup or transfer',
    inputSchema: {},
    annotations: { title: 'Export board', readOnlyHint: true },
    handler: async () => ({ tasks: ref.current.tasks, columns: ref.current.columns }),
  });

  // ---- WRITE ----------------------------------------------------------------
  useWebMCP({
    name: 'add_task',
    description: 'Add a task. Only text is required; other fields default sensibly.',
    inputSchema: {
      text: z.string().describe('Task title'),
      priority: priorityEnum.optional(),
      tags: z.array(z.string()).optional(),
      due: dateStr.optional(),
      assignee: z.string().optional(),
      column: z.string().optional().describe('Target column id (default: first column)'),
      notes: z.string().optional(),
    },
    annotations: { title: 'Add task' },
    handler: async (a: {
      text: string; priority?: Task['priority']; tags?: string[];
      due?: string; assignee?: string; column?: string; notes?: string;
    }) => {
      dispatch({ type: 'ADD_TASK', task: { ...a, columnId: a.column } });
      return { ok: true, added: a.text };
    },
  });

  useWebMCP({
    name: 'edit_task',
    description: 'Edit a task. Provide id plus any fields to change (text, notes).',
    inputSchema: {
      id: z.string(),
      text: z.string().optional(),
      notes: z.string().optional(),
    },
    annotations: { title: 'Edit task' },
    handler: async ({ id, ...patch }: { id: string; text?: string; notes?: string }) => {
      if (!find(ref.current, id)) return { error: 'not_found', id };
      dispatch({ type: 'EDIT_TASK', id, patch });
      return { ok: true, id };
    },
  });

  useWebMCP({
    name: 'toggle_task',
    description: 'Toggle a task done/undone by id',
    inputSchema: { id: z.string() },
    annotations: { title: 'Toggle task' },
    handler: async ({ id }: { id: string }) => {
      if (!find(ref.current, id)) return { error: 'not_found', id };
      dispatch({ type: 'TOGGLE_TASK', id });
      return { ok: true, id };
    },
  });

  useWebMCP({
    name: 'set_priority',
    description: 'Set a task priority (low/medium/high/urgent)',
    inputSchema: { id: z.string(), priority: priorityEnum },
    annotations: { title: 'Set priority' },
    handler: async ({ id, priority }: { id: string; priority: Task['priority'] }) => {
      if (!find(ref.current, id)) return { error: 'not_found', id };
      dispatch({ type: 'SET_PRIORITY', id, priority });
      return { ok: true, id, priority };
    },
  });

  useWebMCP({
    name: 'set_due_date',
    description: 'Set or clear a task due date. Pass due=null to clear.',
    inputSchema: { id: z.string(), due: dateStr.nullable() },
    annotations: { title: 'Set due date' },
    handler: async ({ id, due }: { id: string; due: string | null }) => {
      if (!find(ref.current, id)) return { error: 'not_found', id };
      dispatch({ type: 'SET_DUE', id, due });
      return { ok: true, id, due };
    },
  });

  useWebMCP({
    name: 'add_tag',
    description: 'Add a tag to a task',
    inputSchema: { id: z.string(), tag: z.string() },
    annotations: { title: 'Add tag' },
    handler: async ({ id, tag }: { id: string; tag: string }) => {
      if (!find(ref.current, id)) return { error: 'not_found', id };
      dispatch({ type: 'ADD_TAG', id, tag });
      return { ok: true, id, tag };
    },
  });

  useWebMCP({
    name: 'remove_tag',
    description: 'Remove a tag from a task',
    inputSchema: { id: z.string(), tag: z.string() },
    annotations: { title: 'Remove tag' },
    handler: async ({ id, tag }: { id: string; tag: string }) => {
      dispatch({ type: 'REMOVE_TAG', id, tag });
      return { ok: true, id, tag };
    },
  });

  useWebMCP({
    name: 'assign_task',
    description: 'Assign a task to someone, or pass assignee=null to unassign',
    inputSchema: { id: z.string(), assignee: z.string().nullable() },
    annotations: { title: 'Assign task' },
    handler: async ({ id, assignee }: { id: string; assignee: string | null }) => {
      if (!find(ref.current, id)) return { error: 'not_found', id };
      dispatch({ type: 'ASSIGN', id, assignee });
      return { ok: true, id, assignee };
    },
  });

  useWebMCP({
    name: 'move_task',
    description: 'Move a task to a column (lane) and optional position within it',
    inputSchema: {
      id: z.string(),
      column: z.string().describe('Destination column id'),
      position: z.number().int().min(0).optional().describe('Zero-based slot in the column'),
    },
    annotations: { title: 'Move task' },
    handler: async ({ id, column, position }: { id: string; column: string; position?: number }) => {
      if (!find(ref.current, id)) return { error: 'not_found', id };
      dispatch({ type: 'MOVE_TASK', id, columnId: column, position });
      return { ok: true, id, column, position };
    },
  });

  useWebMCP({
    name: 'mark_all_done',
    description: 'Mark every task done, optionally scoped to one column',
    inputSchema: { column: z.string().optional() },
    annotations: { title: 'Mark all done' },
    handler: async ({ column }: { column?: string }) => {
      const before = visibleTasks(ref.current).filter((t) => !t.done).length;
      dispatch({ type: 'MARK_ALL_DONE', columnId: column });
      return { ok: true, completed: before };
    },
  });

  useWebMCP({
    name: 'add_column',
    description: 'Add a new column (lane) to the board',
    inputSchema: { title: z.string() },
    annotations: { title: 'Add column' },
    handler: async ({ title }: { title: string }) => {
      dispatch({ type: 'ADD_COLUMN', title });
      return { ok: true, title };
    },
  });

  useWebMCP({
    name: 'rename_column',
    description: 'Rename a column by id',
    inputSchema: { id: z.string(), title: z.string() },
    annotations: { title: 'Rename column' },
    handler: async ({ id, title }: { id: string; title: string }) => {
      dispatch({ type: 'RENAME_COLUMN', id, title });
      return { ok: true, id, title };
    },
  });

  useWebMCP({
    name: 'set_view',
    description: 'Switch the app view between board (kanban), list, and calendar',
    inputSchema: { view: viewEnum },
    annotations: { title: 'Set view' },
    handler: async ({ view }: { view: State['view'] }) => {
      dispatch({ type: 'SET_VIEW', view });
      return { ok: true, view };
    },
  });

  useWebMCP({
    name: 'set_filter',
    description: 'Filter the board by search text, tag, priority, assignee, and/or status',
    inputSchema: {
      search: z.string().optional(),
      tag: z.string().nullable().optional(),
      priority: priorityEnum.nullable().optional(),
      assignee: z.string().nullable().optional(),
      status: statusEnum.optional(),
    },
    annotations: { title: 'Set filter' },
    handler: async (patch: Record<string, unknown>) => {
      dispatch({ type: 'SET_FILTER', patch });
      return { ok: true, filter: { ...ref.current.filter, ...patch } };
    },
  });

  useWebMCP({
    name: 'clear_filter',
    description: 'Reset all board filters to show everything',
    inputSchema: {},
    annotations: { title: 'Clear filter' },
    handler: async () => {
      dispatch({ type: 'CLEAR_FILTER' });
      return { ok: true, filter: emptyFilter() };
    },
  });

  useWebMCP({
    name: 'go_to_page',
    description: 'Navigate the user to a page (board, analytics, archive, settings) and scroll to top',
    inputSchema: { page: pageEnum },
    annotations: { title: 'Go to page' },
    handler: async ({ page }: { page: State['route'] }) => {
      dispatch({ type: 'SET_ROUTE', route: page });
      scrollAfterRender(`${page}-top`);
      return { ok: true, page };
    },
  });

  useWebMCP({
    name: 'scroll_to',
    description:
      'Drive the user to a named section, switching pages first if needed, then smooth-scrolling it into view. Use list_pages to see section ids.',
    inputSchema: { section: z.string().describe('Section id, e.g. "by-priority" or "danger-zone"') },
    annotations: { title: 'Scroll to section' },
    handler: async ({ section }: { section: string }) => {
      const target = sectionById(section);
      if (!target) return { error: 'unknown_section', section, known: SECTIONS.map((s) => s.id) };
      if (ref.current.route !== target.page) dispatch({ type: 'SET_ROUTE', route: target.page });
      scrollAfterRender(target.id);
      return { ok: true, page: target.page, section: target.id, title: target.title };
    },
  });

  useWebMCP({
    name: 'undo',
    description: 'Undo the last board mutation (add/edit/move/delete)',
    inputSchema: {},
    annotations: { title: 'Undo' },
    handler: async () => {
      const depth = ref.current.past.length;
      dispatch({ type: 'UNDO' });
      return { ok: depth > 0, remaining: Math.max(0, depth - 1) };
    },
  });

  // ---- DESTRUCTIVE (routed through the human gate) --------------------------
  useWebMCP({
    name: 'delete_task',
    description: 'Delete a single task by id',
    inputSchema: { id: z.string() },
    annotations: { title: 'Delete task', destructiveHint: true },
    handler: async ({ id }: { id: string }) => {
      dispatch({ type: 'DELETE_TASK', id });
      return { ok: true, id };
    },
  });

  useWebMCP({
    name: 'delete_all_tasks',
    description: 'Delete every task on the board',
    inputSchema: {},
    annotations: { title: 'Clear board', destructiveHint: true },
    handler: async () => {
      const cleared = ref.current.tasks.length;
      dispatch({ type: 'DELETE_ALL' });
      return { ok: true, cleared };
    },
  });

  useWebMCP({
    name: 'clear_completed',
    description: 'Permanently delete all completed (done) tasks',
    inputSchema: {},
    annotations: { title: 'Clear completed', destructiveHint: true },
    handler: async () => {
      const cleared = ref.current.tasks.filter((t) => t.done).length;
      dispatch({ type: 'CLEAR_COMPLETED' });
      return { ok: true, cleared };
    },
  });

  useWebMCP({
    name: 'archive_done',
    description: 'Archive all completed tasks (hides them; reversible via undo)',
    inputSchema: {},
    annotations: { title: 'Archive done', destructiveHint: true },
    handler: async () => {
      const archived = ref.current.tasks.filter((t) => t.done && !t.archived).length;
      dispatch({ type: 'ARCHIVE_DONE' });
      return { ok: true, archived };
    },
  });

  useWebMCP({
    name: 'delete_column',
    description: 'Delete a column AND every task inside it',
    inputSchema: { id: z.string() },
    annotations: { title: 'Delete column', destructiveHint: true },
    handler: async ({ id }: { id: string }) => {
      const lost = ref.current.tasks.filter((t) => t.columnId === id).length;
      dispatch({ type: 'DELETE_COLUMN', id });
      return { ok: true, id, tasksDeleted: lost };
    },
  });

  useWebMCP({
    name: 'bulk_delete',
    description: 'Delete every task matching a filter (by priority, tag, or status). At least one filter required.',
    inputSchema: {
      priority: priorityEnum.optional(),
      tag: z.string().optional(),
      status: statusEnum.optional(),
    },
    annotations: { title: 'Bulk delete', destructiveHint: true },
    handler: async (f: { priority?: Task['priority']; tag?: string; status?: string }) => {
      if (!f.priority && !f.tag && (!f.status || f.status === 'all')) {
        return { error: 'refused', reason: 'at least one narrowing filter required' };
      }
      const ids = ref.current.tasks
        .filter((t) => {
          if (f.priority && t.priority !== f.priority) return false;
          if (f.tag && !t.tags.includes(f.tag)) return false;
          if (f.status === 'done' && !t.done) return false;
          if (f.status === 'active' && t.done) return false;
          return true;
        })
        .map((t) => t.id);
      dispatch({ type: 'BULK_DELETE', ids });
      return { ok: true, deleted: ids.length };
    },
  });

  useWebMCP({
    name: 'import_board',
    description: 'Replace the entire board with imported tasks and columns (overwrites current state)',
    inputSchema: {
      tasks: z.array(z.any()).describe('Full task objects, as produced by export_board'),
      columns: z.array(z.any()).describe('Full column objects'),
    },
    annotations: { title: 'Import board', destructiveHint: true },
    handler: async ({ tasks, columns }: { tasks: Task[]; columns: State['columns'] }) => {
      dispatch({ type: 'IMPORT', tasks, columns });
      return { ok: true, tasks: tasks.length, columns: columns.length };
    },
  });
}

export const PRIORITY_LIST = PRIORITIES;
