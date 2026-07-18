import { Undo2 } from 'lucide-react';
import { grabAnchor } from '@embinder/react';
import { type Action, type State } from '../store';

export function Archive({ state, dispatch }: { state: State; dispatch: (a: Action) => void }) {
  const archived = state.tasks.filter((t) => t.archived);
  const colTitle = (id: string) => state.columns.find((c) => c.id === id)?.title ?? id;

  return (
    <div id="archive-top" className="page">
      <section id="archive-list" className="panel">
        <h2 className="panel-title" data-embinder-tool="scroll_to">Archived tasks ({archived.length})</h2>
        <p className="hint">Archived tasks are hidden from every board view. Restore or delete them here.</p>
        <div className="arch-rows">
          {archived.map((t) => (
            <div key={t.id} className="arch-row">
              <span className={`prio prio-${t.priority} inline`} />
              <span className="arch-text">{t.text}</span>
              <span className="arch-col">{colTitle(t.columnId)}</span>
              <button
                className="chip"
                {...grabAnchor('edit_task')}
                onClick={() => dispatch({ type: 'EDIT_TASK', id: t.id, patch: { archived: false } })}
              >
                <Undo2 size={13} strokeWidth={2} aria-hidden /> Restore
              </button>
              <button
                className="chip danger"
                {...grabAnchor('delete_task')}
                onClick={() => dispatch({ type: 'DELETE_TASK', id: t.id })}
              >
                Delete
              </button>
            </div>
          ))}
          {archived.length === 0 && <p className="col-empty">Nothing archived. Use “Archive done” on the board.</p>}
        </div>
      </section>
    </div>
  );
}
