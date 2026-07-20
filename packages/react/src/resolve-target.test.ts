import { describe, it, expect, afterEach } from 'vitest';
import { resolveAgentTarget } from './resolve-target.js';

function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html;
  const node = d.firstElementChild as HTMLElement;
  document.body.appendChild(node);
  return node;
}
function rect(node: HTMLElement, r: Partial<DOMRect>) {
  node.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, ...r }) as DOMRect;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('resolveAgentTarget', () => {
  it('resolves a declared scope anchor', () => {
    const scope = document.createElement('section');
    scope.setAttribute('data-embinder-scope', 'inbox/task_t1');
    document.body.append(scope);
    expect(resolveAgentTarget('focus_inbox__task_t1', undefined, 'inbox/task_t1')).toBe(scope);
  });

  it('resolves an explicit fallback focus anchor for a read-only tool', () => {
    const tags = document.createElement('div');
    tags.setAttribute('data-embinder-focus-for', 'list_tags');
    document.body.append(tags);
    expect(resolveAgentTarget('list_tags')).toBe(tags);
  });

  it('resolves a single tool anchor by name', () => {
    const b = el('<button data-embinder-tool="undo">Undo</button>');
    expect(resolveAgentTarget('undo')).toBe(b);
  });

  it('among multiple tool anchors, picks the largest visible one', () => {
    const a = el('<button data-embinder-tool="del">a</button>');
    const b = el('<button data-embinder-tool="del">b</button>');
    rect(a, { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 });
    rect(b, { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 });
    expect(resolveAgentTarget('del')).toBe(b);
  });

  it('falls back to the item anchor by id when no tool anchor exists', () => {
    const row = el('<article data-embinder-item="t3">row</article>');
    expect(resolveAgentTarget('toggle_task', 't3')).toBe(row);
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveAgentTarget('missing', 'nope')).toBeUndefined();
  });
});
