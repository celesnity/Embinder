import { useState } from 'react';
import { grabAnchor, useDropZone, useScrollTarget } from '@embinder/react';
import { type Action, type Column as Col, type State, tasksInColumn } from '../store';
import { TaskCard } from './TaskCard';

export function Column({ col, state, dispatch }: { col: Col; state: State; dispatch: (a: Action) => void }) {
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const tasks = tasksInColumn(state, col.id);

  const zone = useDropZone('column', { id: col.id, label: col.title, accepts: ['card'] });
  const scroll = useScrollTarget({ id: `col-${col.id}`, label: `${col.title} column` });
  const setRefs = (el: HTMLElement | null) => { zone.ref(el); scroll.ref(el); };

  const submitAdd = () => {
    const text = draft.trim();
    if (text) dispatch({ type: 'ADD_TASK', task: { text, columnId: col.id } });
    setDraft('');
    setAdding(false);
  };

  return (
    <section
      ref={setRefs}
      className={`col${over ? ' drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id) dispatch({ type: 'MOVE_TASK', id, columnId: col.id });
        setOver(false);
      }}
    >
      <header className="col-head">
        <input
          className="col-title"
          value={col.title}
          {...grabAnchor('rename_column')}
          onChange={(e) => dispatch({ type: 'RENAME_COLUMN', id: col.id, title: e.target.value })}
        />
        <span className="count">{tasks.length}</span>
        <button
          className="col-x"
          {...grabAnchor('delete_column')}
          onClick={() => dispatch({ type: 'DELETE_COLUMN', id: col.id })}
          title="Delete column and its tasks"
        >
          ✕
        </button>
      </header>

      <div className="col-body">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} dispatch={dispatch} />
        ))}
        {tasks.length === 0 && <p className="col-empty">Drop tasks here</p>}
      </div>

      {adding ? (
        <input
          className="col-add-input"
          autoFocus
          value={draft}
          placeholder="Task title…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submitAdd}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAdd();
            if (e.key === 'Escape') { setDraft(''); setAdding(false); }
          }}
        />
      ) : (
        <button className="col-add" {...grabAnchor('add_task')} onClick={() => { setDraft(''); setAdding(true); }}>
          + Add task
        </button>
      )}
    </section>
  );
}
