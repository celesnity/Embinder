import { useEffect, useReducer, useRef, useState } from 'react';
import { LayoutGrid, BarChart3, Archive as ArchiveIcon, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import { grabAnchor, useScrollTarget } from '@embinder/react';
import { reducer, initialState, PAGES, type State, type Page } from './store';
import { useBoardTools } from './tools';
import { Toolbar } from './components/Toolbar';
import { Board } from './components/Board';
import { ListView, type SortKey } from './components/ListView';
import { CalendarView } from './components/CalendarView';
import { Analytics } from './components/Analytics';
import { Archive } from './components/Archive';
import { Settings } from './components/Settings';
import './App.css';

const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'archive', label: 'Archive', icon: ArchiveIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

const routeFromHash = (): Page => {
  const h = window.location.hash.replace(/^#\/?/, '') as Page;
  return PAGES.includes(h) ? h : 'board';
};

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState, (s) => ({ ...s, route: routeFromHash() }));
  const [sort, setSort] = useState<SortKey>('priority');

  const stateRef = useRef<State>(state);
  stateRef.current = state;

  useBoardTools(stateRef, dispatch);
  const topTarget = useScrollTarget({ id: 'app-top', label: 'Top of the app' });

  // Two-way sync route <-> URL hash (agent nav updates the address bar; back/forward works).
  useEffect(() => {
    if (routeFromHash() !== state.route) window.location.hash = `/${state.route}`;
  }, [state.route]);
  useEffect(() => {
    const onHash = () => dispatch({ type: 'SET_ROUTE', route: routeFromHash() });
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <main className="app">
      <header id="board-top" ref={topTarget.ref} className="app-head">
        <div>
          <h1>Embinder Board</h1>
          <p className="hint">
            {state.tasks.length} tasks · {state.columns.length} columns · 4 pages · 35 tools via WebMCP → relay gate
          </p>
        </div>
        <nav className="topnav" {...grabAnchor('go_to_page')}>
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                className={state.route === n.id ? 'nav on' : 'nav'}
                onClick={() => dispatch({ type: 'SET_ROUTE', route: n.id })}
              >
                <Icon className="nav-icon" size={15} strokeWidth={2} aria-hidden /> {n.label}
              </button>
            );
          })}
        </nav>
      </header>

      {state.route === 'board' && (
        <>
          <Toolbar state={state} dispatch={dispatch} />
          {state.view === 'board' && <Board state={state} dispatch={dispatch} />}
          {state.view === 'list' && <ListView state={state} dispatch={dispatch} sort={sort} onSort={setSort} />}
          {state.view === 'calendar' && <CalendarView state={state} dispatch={dispatch} />}
        </>
      )}
      {state.route === 'analytics' && <Analytics state={state} />}
      {state.route === 'archive' && <Archive state={state} dispatch={dispatch} />}
      {state.route === 'settings' && <Settings state={state} dispatch={dispatch} />}
    </main>
  );
}
