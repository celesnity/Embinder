// Resolve the DOM element an agent action targets. A tool anchored on one element resolves by
// its data-embinder-tool name; when several share it (same action on two pages) pick the one
// with the largest visible slice of the viewport. Collection item tools have no tool anchor —
// they resolve to the specific item by data-embinder-item, keyed on the call's id argument.

export const EMBINDER_ITEM_ATTR = 'data-embinder-item';

function largestVisible(nodes: ArrayLike<Element>): Element | undefined {
  let best: Element | undefined;
  let bestArea = -1;
  for (let i = 0; i < nodes.length; i++) {
    const r = nodes[i].getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue; // display:none / detached
    const vw = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const vh = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const area = vw * vh;
    if (area > bestArea) { bestArea = area; best = nodes[i]; }
  }
  return best;
}

export function resolveAgentTarget(name: string, itemId?: string): Element | undefined {
  const esc = window.CSS?.escape ?? ((x: string) => x);
  const byTool = document.querySelectorAll(`[data-embinder-tool="${esc(name)}"]`);
  if (byTool.length === 1) return byTool[0];
  if (byTool.length > 1) return largestVisible(byTool) ?? byTool[0];
  // No tool anchor (a collection item tool): resolve the specific item by id.
  if (itemId != null && itemId !== '') {
    const byItem = document.querySelectorAll(`[${EMBINDER_ITEM_ATTR}="${esc(itemId)}"]`);
    if (byItem.length) return largestVisible(byItem) ?? byItem[0];
  }
  return undefined;
}
