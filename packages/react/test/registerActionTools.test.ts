import { describe, it, expect, beforeAll } from 'vitest';
import type { ModelContextSurface, ToolDescriptor } from '../src/model-context.js';
import { installActionTools } from '../src/actions/registerActionTools.js';
import { setScrollTarget, setDraggable, setDropZone } from '../src/actions/registry.js';

// One shared registered array + ctx — installActionTools has a module-level `installed`
// singleton so only the first call subscribes the reconcile listener. Both tests below
// share this state and assert against the latest registration for each tool name.
const registered: ToolDescriptor[] = [];
const ctx: ModelContextSurface = { registerTool: (d) => void registered.push(d) };

describe('registerActionTools', () => {
  beforeAll(() => {
    installActionTools(ctx);
  });

  it('registers ui_scroll_to with an enum of ids and readOnly risk', async () => {
    setScrollTarget({ id: 'about', label: 'About', el: document.createElement('div') });
    await Promise.resolve();
    await Promise.resolve();

    const scroll = [...registered].reverse().find((d) => d.name === 'ui_scroll_to');
    expect(scroll).toBeTruthy();
    const schema = scroll!.inputSchema as { properties: { target: { enum: string[] } } };
    expect(schema.properties.target.enum).toContain('about');
    expect(scroll!.annotations?.readOnlyHint).toBe(true);
  });

  it('marks ui_drag_and_drop destructive and validates accepts on execute', async () => {
    setDraggable({ kind: 'card', id: 'c1', label: 'C1', el: document.createElement('div') });
    setDropZone({ kind: 'card', id: 'colOnly', label: 'Col', el: document.createElement('div'), accepts: ['col'] });
    await Promise.resolve();
    await Promise.resolve();

    const drag = [...registered].reverse().find((d) => d.name === 'ui_drag_and_drop');
    expect(drag!.annotations?.destructiveHint).toBe(true);
    await expect(drag!.execute({ item: 'c1', onto: 'colOnly' })).rejects.toThrow(/does not accept/);
  });
});
