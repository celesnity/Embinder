import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { grabAnchor } from '@embinder/react';
import { type Action, type State, visibleTasks } from '../store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function CalendarView({ state, dispatch }: { state: State; dispatch: (a: Action) => void }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const tasks = visibleTasks(state);

  const byDay = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (!t.due) continue;
    const arr = byDay.get(t.due) ?? [];
    arr.push(t);
    byDay.set(t.due, arr);
  }
  const unscheduled = tasks.filter((t) => !t.due);

  const first = new Date(cursor.y, cursor.m, 1);
  const startPad = first.getDay();
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  const today = ymd(now);

  const shift = (delta: number) => {
    const m = cursor.m + delta;
    setCursor({ y: cursor.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
  };

  return (
    <div className="calendar">
      <header className="cal-head">
        <button className="chip" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={15} strokeWidth={2.2} aria-hidden /></button>
        <h2>{MONTHS[cursor.m]} {cursor.y}</h2>
        <button className="chip" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={15} strokeWidth={2.2} aria-hidden /></button>
      </header>
      <div className="cal-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`p${i}`} className="cal-cell empty" />;
          const key = ymd(new Date(cursor.y, cursor.m, day));
          const items = byDay.get(key) ?? [];
          return (
            <div key={key} className={`cal-cell${key === today ? ' today' : ''}`}>
              <span className="cal-day">{day}</span>
              {items.map((t) => (
                <button
                  key={t.id}
                  className={`cal-task prio-bg-${t.priority}${t.done ? ' done' : ''}`}
                  {...grabAnchor('toggle_task')}
                  onClick={() => dispatch({ type: 'TOGGLE_TASK', id: t.id })}
                  title={t.text}
                >
                  {t.text}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {unscheduled.length > 0 && (
        <div className="cal-unscheduled">
          <h3>Unscheduled ({unscheduled.length})</h3>
          <div className="cal-unsched-row">
            {unscheduled.map((t) => (
              <button
                key={t.id}
                className={`cal-task prio-bg-${t.priority}`}
                {...grabAnchor('set_due_date')}
                onClick={() => dispatch({ type: 'SET_DUE', id: t.id, due: today })}
                title="Click to schedule today"
              >
                {t.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
