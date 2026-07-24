import { useReducer, useRef, useState } from 'react';
import { Columns3, List as ListIcon, CalendarDays, type LucideIcon } from 'lucide-react';
import { useEmbinder } from '@embinder/react';
import {
  reducer,
  initialState,
  visibleTasks,
  boardStats,
  type Page,
  type ViewMode,
} from './store';
import { useBoardTools } from './tools';
import { Board } from './components/Board';
import { ListView, type SortKey } from './components/ListView';
import { CalendarView } from './components/CalendarView';
import { Analytics } from './components/Analytics';
import { Archive } from './components/Archive';
import { Settings } from './components/Settings';
import { Toolbar } from './components/Toolbar';
import './App.css';

// One store, four pages. Each page mounts its own render-scoped useEmbinder CONTEXT pointer,
// so the agent's picture of the app follows the screen the user is on — navigate and the
// context switches with you. Navigation and every mutation are exposed to the agent as
// WebMCP tools by useBoardTools(); the pointers below are read-only context, no handlers.

const PAGE_TABS: { id: Page; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'archive', label: 'Archive' },
  { id: 'settings', label: 'Settings' },
];

const VIEW_TABS: { id: ViewMode; label: string; icon: LucideIcon }[] = [
  { id: 'board', label: 'Board', icon: Columns3 },
  { id: 'list', label: 'List', icon: ListIcon },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
];
export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [sort, setSort] = useState<SortKey>('priority');

  // Keep a live ref so the WebMCP tool handlers always read the latest state.
  const stateRef = useRef(state);
  stateRef.current = state;
  useBoardTools(stateRef, dispatch);

  const stats = boardStats(state);

  // Render-scoped context pointer: whichever page is on screen contributes its own summary.
  // Context-only (no handler) => never a callable tool, purely the agent's live view (D-5).
  useEmbinder({
    name: 'current_screen',
    description: 'A live summary of the page the user is currently looking at',
    context: () => {
      const base = { page: state.route, view: state.view, ...stats };
      switch (state.route) {
        case 'board':
          return { ...base, tasks: visibleTasks(state).map((t) => ({ id: t.id, text: t.text, column: t.columnId, priority: t.priority, done: t.done })) };
        case 'analytics':
          return { ...base, byPriority: stats.byPriority, byColumn: stats.byColumn };
        case 'archive':
          return { ...base, archived: state.tasks.filter((t) => t.archived).map((t) => ({ id: t.id, text: t.text })) };
        case 'settings':
          return { ...base, columns: state.columns.map((c) => ({ id: c.id, title: c.title })) };
      }
    },
  });

  return (
    <main className="app">
      <header className="app-head">
        <h1>Embinder Todo</h1>
        <p className="hint">
          The agent sees a render-scoped context that follows the page you're on — navigate,
          and its picture of the app switches with you.
        </p>

        <nav className="nav-seg" aria-label="Pages">
          {PAGE_TABS.map((p) => (
            <button
              key={p.id}
              className={state.route === p.id ? 'nav on' : 'nav'}
              aria-current={state.route === p.id}
              onClick={() => dispatch({ type: 'SET_ROUTE', route: p.id })}
            >
              {p.label}
            </button>
          ))}
        </nav>
      </header>

      {state.route === 'board' && (
        <div id="board-top" className="page board-page">
          <div className="view-seg" aria-label="Views">
            {VIEW_TABS.map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.id}
                  className={state.view === v.id ? 'seg on' : 'seg'}
                  onClick={() => dispatch({ type: 'SET_VIEW', view: v.id })}
                >
                  <Icon size={14} strokeWidth={2} aria-hidden /> {v.label}
                </button>
              );
            })}
          </div>

          <Toolbar state={state} dispatch={dispatch} />

          {state.view === 'board' && <Board state={state} dispatch={dispatch} />}
          {state.view === 'list' && <ListView state={state} dispatch={dispatch} sort={sort} onSort={setSort} />}
          {state.view === 'calendar' && <CalendarView state={state} dispatch={dispatch} />}
        </div>
      )}

      {state.route === 'analytics' && <Analytics state={state} />}
      {state.route === 'archive' && <Archive state={state} dispatch={dispatch} />}
      {state.route === 'settings' && <Settings state={state} dispatch={dispatch} />}
    </main>
  );
}
