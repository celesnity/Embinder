import { useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { grabAnchor, useDraggable } from '@embinder/react';
import { type Action, type Task, type Priority } from '../store';

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low',
};

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export function TaskCard({
  task,
  dispatch,
  draggable = true,
}: {
  task: Task;
  dispatch: (a: Action) => void;
  draggable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.text);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = task.due && task.due < today && !task.done;

  const commit = () => {
    const v = text.trim();
    if (v && v !== task.text) dispatch({ type: 'EDIT_TASK', id: task.id, patch: { text: v } });
    else setText(task.text);
    setEditing(false);
  };

  const drag = useDraggable('card', { id: task.id, label: task.text });

  return (
    <article
      ref={drag.ref}
      className={`card${task.done ? ' done' : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      data-priority={task.priority}
    >
      <span className={`prio prio-${task.priority}`} title={PRIORITY_LABEL[task.priority]} />

      <label className="check">
        <input
          type="checkbox"
          checked={task.done}
          {...grabAnchor('toggle_task')}
          onChange={() => dispatch({ type: 'TOGGLE_TASK', id: task.id })}
        />
      </label>

      <div className="card-body">
        {editing ? (
          <input
            className="card-edit"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setText(task.text); setEditing(false); }
            }}
          />
        ) : (
          <span className="card-text" {...grabAnchor('edit_task')} onDoubleClick={() => setEditing(true)}>
            {task.text}
          </span>
        )}

        <div className="card-meta">
          {task.due && (
            <span className={`due${overdue ? ' overdue' : ''}`} {...grabAnchor('set_due_date')}>
              <CalendarClock size={12} strokeWidth={2} aria-hidden /> {task.due}
            </span>
          )}
          {task.tags.map((tag) => (
            <button
              key={tag}
              className="tag"
              {...grabAnchor('remove_tag')}
              onClick={() => dispatch({ type: 'REMOVE_TAG', id: task.id, tag })}
              title="Remove tag"
            >
              #{tag}
            </button>
          ))}
        </div>
      </div>

      {task.assignee && (
        <span className="avatar" {...grabAnchor('assign_task')} title={task.assignee}>
          {initials(task.assignee)}
        </span>
      )}

      <button
        className="x"
        {...grabAnchor('delete_task')}
        onClick={() => dispatch({ type: 'DELETE_TASK', id: task.id })}
        title="Delete task"
        aria-label="Delete task"
      >
        <X size={14} strokeWidth={2.2} aria-hidden />
      </button>
    </article>
  );
}
