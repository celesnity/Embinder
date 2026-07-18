import { type Action, type State, type Priority, PRIORITY_RANK, visibleTasks } from '../store';
import { TaskCard } from './TaskCard';

type SortKey = 'priority' | 'due' | 'created';

const cmp: Record<SortKey, (a: { priority: Priority; due: string | null; createdAt: number }, b: { priority: Priority; due: string | null; createdAt: number }) => number> = {
  priority: (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority],
  due: (a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'),
  created: (a, b) => a.createdAt - b.createdAt,
};

export function ListView({
  state,
  dispatch,
  sort,
  onSort,
}: {
  state: State;
  dispatch: (a: Action) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
}) {
  const tasks = [...visibleTasks(state)].sort(cmp[sort]);
  const colTitle = (id: string) => state.columns.find((c) => c.id === id)?.title ?? id;

  return (
    <div className="list-view">
      <div className="list-sort">
        <span>Sort:</span>
        {(['priority', 'due', 'created'] as SortKey[]).map((k) => (
          <button key={k} className={sort === k ? 'chip on' : 'chip'} onClick={() => onSort(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="list-rows">
        {tasks.map((t) => (
          <div key={t.id} className="list-row">
            <span className="list-col-badge">{colTitle(t.columnId)}</span>
            <TaskCard task={t} dispatch={dispatch} draggable={false} />
          </div>
        ))}
        {tasks.length === 0 && <p className="col-empty">No tasks match the filter</p>}
      </div>
    </div>
  );
}

export type { SortKey };
