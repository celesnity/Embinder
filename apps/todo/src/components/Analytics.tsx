import { type State, type Priority, PRIORITIES, boardStats, visibleTasks } from '../store';

const PRIO_COLOR: Record<Priority, string> = {
  urgent: 'var(--prio-urgent)', high: 'var(--prio-high)',
  medium: 'var(--prio-medium)', low: 'var(--prio-low)',
};

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} />
      </div>
      <span className="bar-val">{value}</span>
    </div>
  );
}

export function Analytics({ state }: { state: State }) {
  const s = boardStats(state);
  const cols = [...state.columns].sort((a, b) => a.order - b.order);
  const maxCol = Math.max(1, ...cols.map((c) => s.byColumn[c.id] ?? 0));
  const maxPrio = Math.max(1, ...PRIORITIES.map((p) => s.byPriority[p]));
  const recent = [...visibleTasks(state)].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;

  return (
    <div id="analytics-top" className="page analytics-page">
      <section id="overview" className="panel">
        <h2 className="panel-title" data-embinder-tool="scroll_to">Overview</h2>
        <div className="stat-grid">
          <div className="stat"><b>{s.total}</b><span>Total</span></div>
          <div className="stat"><b>{s.active}</b><span>Active</span></div>
          <div className="stat"><b>{s.done}</b><span>Done</span></div>
          <div className="stat"><b className={s.overdue ? 'hot' : ''}>{s.overdue}</b><span>Overdue</span></div>
          <div className="stat"><b>{s.archived}</b><span>Archived</span></div>
          <div className="stat"><b>{s.tags}</b><span>Tags</span></div>
        </div>
        <div className="progress-wrap">
          <div className="progress"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <span className="progress-label">{pct}% complete</span>
        </div>
      </section>

      <section id="by-priority" className="panel">
        <h2 className="panel-title" data-embinder-tool="scroll_to">By priority</h2>
        {PRIORITIES.map((p) => (
          <Bar key={p} label={p} value={s.byPriority[p]} max={maxPrio} color={PRIO_COLOR[p]} />
        ))}
      </section>

      <section id="by-column" className="panel">
        <h2 className="panel-title" data-embinder-tool="scroll_to">Column throughput</h2>
        {cols.map((c) => (
          <Bar key={c.id} label={c.title} value={s.byColumn[c.id] ?? 0} max={maxCol} color="var(--accent)" />
        ))}
      </section>

      <section id="activity" className="panel">
        <h2 className="panel-title" data-embinder-tool="scroll_to">Recent activity</h2>
        <ul className="activity">
          {recent.map((t) => (
            <li key={t.id}>
              <span className={`dot prio-${t.priority}`} />
              <span className="act-text">{t.text}</span>
              <span className="act-col">{state.columns.find((c) => c.id === t.columnId)?.title}</span>
            </li>
          ))}
          {recent.length === 0 && <li className="col-empty">No tasks yet</li>}
        </ul>
      </section>
    </div>
  );
}
