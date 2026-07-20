import { grabAnchor, grabFocusAnchor } from '@embinder/react';
import { type Action, type State } from '../store';
import { Column } from './Column';

export function Board({ state, dispatch }: { state: State; dispatch: (a: Action) => void }) {
  const columns = [...state.columns].sort((a, b) => a.order - b.order);
  return (
    <div className="board-cols" {...grabFocusAnchor('list_tasks', 'list_columns')}>
      {columns.map((col) => (
        <Column key={col.id} col={col} state={state} dispatch={dispatch} />
      ))}
      <button
        className="col-new"
        {...grabAnchor('add_column')}
        onClick={() => dispatch({ type: 'ADD_COLUMN', title: 'New column' })}
      >
        + Add column
      </button>
    </div>
  );
}
