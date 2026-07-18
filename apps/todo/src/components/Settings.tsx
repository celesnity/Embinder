import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { grabAnchor } from '@embinder/react';
import { type Action, type State } from '../store';

export function Settings({ state, dispatch }: { state: State; dispatch: (a: Action) => void }) {
  const [io, setIo] = useState('');
  const cols = [...state.columns].sort((a, b) => a.order - b.order);

  const doExport = () =>
    setIo(JSON.stringify({ tasks: state.tasks, columns: state.columns }, null, 2));

  const doImport = () => {
    try {
      const parsed = JSON.parse(io);
      if (Array.isArray(parsed.tasks) && Array.isArray(parsed.columns)) {
        dispatch({ type: 'IMPORT', tasks: parsed.tasks, columns: parsed.columns });
      }
    } catch { /* ignore malformed JSON */ }
  };

  return (
    <div id="settings-top" className="page settings-page">
      <section id="columns-manager" className="panel">
        <h2 className="panel-title" data-embinder-tool="scroll_to">Columns</h2>
        <p className="hint">Rename or remove lanes. Deleting a lane deletes its tasks.</p>
        <div className="set-cols">
          {cols.map((c) => (
            <div key={c.id} className="set-col-row">
              <input
                className="set-input"
                value={c.title}
                {...grabAnchor('rename_column')}
                onChange={(e) => dispatch({ type: 'RENAME_COLUMN', id: c.id, title: e.target.value })}
              />
              <code className="set-id">{c.id}</code>
              <span className="count">{state.tasks.filter((t) => t.columnId === c.id).length}</span>
              <button
                className="chip danger"
                {...grabAnchor('delete_column')}
                onClick={() => dispatch({ type: 'DELETE_COLUMN', id: c.id })}
              >
                Delete
              </button>
            </div>
          ))}
          <button className="chip" {...grabAnchor('add_column')} onClick={() => dispatch({ type: 'ADD_COLUMN', title: 'New column' })}>
            + Add column
          </button>
        </div>
      </section>

      <section id="data" className="panel">
        <h2 className="panel-title" data-embinder-tool="scroll_to">Import / export</h2>
        <p className="hint">Round-trips the same JSON the <code>export_board</code> / <code>import_board</code> tools use.</p>
        <div className="io-actions">
          <button className="chip" {...grabAnchor('export_board')} onClick={doExport}><Download size={13} strokeWidth={2} aria-hidden /> Export to box</button>
          <button className="chip warn" {...grabAnchor('import_board')} onClick={doImport}><Upload size={13} strokeWidth={2} aria-hidden /> Import from box</button>
        </div>
        <textarea
          className="io-box"
          value={io}
          onChange={(e) => setIo(e.target.value)}
          placeholder='{ "tasks": [...], "columns": [...] }'
          spellCheck={false}
        />
      </section>

      <section id="danger-zone" className="panel danger-panel">
        <h2 className="panel-title" data-embinder-tool="scroll_to">Danger zone</h2>
        <p className="hint">Every action here is a destructive tool — it pauses at the human gate when an agent calls it.</p>
        <div className="danger-actions">
          <button className="chip warn" {...grabAnchor('clear_completed')} onClick={() => dispatch({ type: 'CLEAR_COMPLETED' })}>
            Clear completed tasks
          </button>
          <button className="chip warn" {...grabAnchor('archive_done')} onClick={() => dispatch({ type: 'ARCHIVE_DONE' })}>
            Archive done tasks
          </button>
          <button className="chip danger" {...grabAnchor('delete_all_tasks')} onClick={() => dispatch({ type: 'DELETE_ALL' })}>
            Delete ALL tasks
          </button>
        </div>
      </section>
    </div>
  );
}
