import { Columns3, List as ListIcon, CalendarDays, X, Undo2, CheckCheck, type LucideIcon } from 'lucide-react';
import { grabAnchor, AgentButton, AgentInput } from '@embinder/react';
import {
  type Action, type State, type ViewMode, type Priority, type StatusFilter,
  PRIORITIES, boardStats, allTags,
} from '../store';

const VIEWS: { id: ViewMode; label: string; icon: LucideIcon }[] = [
  { id: 'board', label: 'Board', icon: Columns3 },
  { id: 'list', label: 'List', icon: ListIcon },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
];

export function Toolbar({ state, dispatch }: { state: State; dispatch: (a: Action) => void }) {
  const stats = boardStats(state);
  const tags = allTags(state);
  const f = state.filter;
  const active =
    f.search || f.tag || f.priority || f.assignee || f.status !== 'all';

  return (
    <div className="toolbar">
      <div className="tb-row">
        <div className="tb-views" {...grabAnchor('set_view')}>
          {VIEWS.map((v) => {
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

        {/* Agent-aware input: the agent "types" into this box to filter, and its current
            value is reported live. One component = tool + anchor + DOM driver. */}
        <AgentInput
          name="set_search"
          description="The board search box. Set it to filter visible tasks by matching text; the current query is reported as live state."
          className="tb-search"
          placeholder="Search tasks…"
          value={f.search}
          onChange={(e) => dispatch({ type: 'SET_FILTER', patch: { search: e.target.value } })}
        />

        <div className="tb-stats" {...grabAnchor('board_stats')} title="Board stats">
          <b>{stats.active}</b> active · <b>{stats.done}</b> done
          {stats.overdue > 0 && <span className="overdue"> · {stats.overdue} overdue</span>}
        </div>
      </div>

      <div className="tb-row wrap">
        <span className="tb-label">Status</span>
        {(['all', 'active', 'done'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            className={f.status === s ? 'chip on' : 'chip'}
            {...grabAnchor('set_filter')}
            onClick={() => dispatch({ type: 'SET_FILTER', patch: { status: s } })}
          >
            {s}
          </button>
        ))}

        <span className="tb-label">Priority</span>
        {PRIORITIES.map((p: Priority) => (
          <button
            key={p}
            className={`chip prio-chip prio-${p}${f.priority === p ? ' on' : ''}`}
            {...grabAnchor('set_filter')}
            onClick={() =>
              dispatch({ type: 'SET_FILTER', patch: { priority: f.priority === p ? null : p } })
            }
          >
            {p}
          </button>
        ))}

        {tags.length > 0 && <span className="tb-label">Tags</span>}
        {tags.map((tag) => (
          <button
            key={tag}
            className={f.tag === tag ? 'chip on' : 'chip'}
            {...grabAnchor('set_filter')}
            onClick={() => dispatch({ type: 'SET_FILTER', patch: { tag: f.tag === tag ? null : tag } })}
          >
            #{tag}
          </button>
        ))}

        {active && (
          <button className="chip clear" {...grabAnchor('clear_filter')} onClick={() => dispatch({ type: 'CLEAR_FILTER' })}>
            <X size={13} strokeWidth={2.4} aria-hidden /> clear
          </button>
        )}
      </div>

      <div className="tb-row wrap actions">
        {/* Agent-aware buttons: the agent invokes the tool, which clicks the real button
            (same path a user takes). Undo reports its disabled state live. */}
        <AgentButton
          name="undo"
          description="Undo the last board change. Disabled (and a no-op) when there is nothing to undo — the disabled state is reported live."
          className="chip"
          disabled={state.past.length === 0}
          onClick={() => dispatch({ type: 'UNDO' })}
        >
          <Undo2 size={14} strokeWidth={2} aria-hidden /> Undo{state.past.length ? ` (${state.past.length})` : ''}
        </AgentButton>
        <AgentButton
          name="mark_all_done"
          description="Mark every visible task on the board as done."
          className="chip"
          onClick={() => dispatch({ type: 'MARK_ALL_DONE' })}
        >
          <CheckCheck size={14} strokeWidth={2} aria-hidden /> Mark all done
        </AgentButton>
        <span className="spacer" />
        <button className="chip warn" {...grabAnchor('clear_completed')} onClick={() => dispatch({ type: 'CLEAR_COMPLETED' })}>
          Clear completed
        </button>
        <button className="chip danger" {...grabAnchor('delete_all_tasks')} onClick={() => dispatch({ type: 'DELETE_ALL' })}>
          Delete all
        </button>
      </div>
    </div>
  );
}
