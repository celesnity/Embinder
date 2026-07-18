// Builds one WebMCP tool per action kind from the live registry and re-registers it
// (fresh schema) whenever participants change. Tools are ui_-namespaced to avoid
// colliding with app-authored tools. Each execute routes into synthesis.
import type { ModelContextSurface, ToolDescriptor } from '../model-context.js';
import { registry, subscribe } from './registry.js';
import { performScroll, performDrag } from './synthesize.js';

interface ToolSpec { name: string; descriptor: ToolDescriptor; }

function enumProp(entries: { id: string; label: string }[], desc: string) {
  return {
    type: 'string',
    enum: entries.map((e) => e.id),
    description: `${desc} Options: ${entries.map((e) => `${e.id} (${e.label})`).join(', ')}`,
  };
}

function buildSpecs(): ToolSpec[] {
  const specs: ToolSpec[] = [];

  const scrolls = [...registry.scrollTargets.values()];
  if (scrolls.length) {
    specs.push({
      name: 'ui_scroll_to',
      descriptor: {
        name: 'ui_scroll_to',
        title: 'Scroll to',
        description: 'Smoothly scroll a declared section into view.',
        inputSchema: { type: 'object', required: ['target'], properties: { target: enumProp(scrolls, 'Which section to scroll to.') } },
        annotations: { title: 'Scroll to', readOnlyHint: true },
        execute: async (args: unknown) => {
          const { target } = (args ?? {}) as { target?: string };
          const t = target ? registry.scrollTargets.get(target) : undefined;
          if (!t) throw new Error(`unknown scroll target: ${target}`);
          await performScroll(t.el);
          return { ok: true, target };
        },
      },
    });
  }

  const routes = [...registry.routes.values()];
  if (routes.length) {
    const destructive = routes.some((r) => r.destructive !== false);
    specs.push({
      name: 'ui_navigate',
      descriptor: {
        name: 'ui_navigate',
        title: 'Navigate',
        description: 'Navigate to a declared page/route.',
        inputSchema: { type: 'object', required: ['page'], properties: { page: enumProp(routes, 'Which page to open.') } },
        annotations: { title: 'Navigate', destructiveHint: destructive },
        execute: async (args: unknown) => {
          const { page } = (args ?? {}) as { page?: string };
          const r = page ? registry.routes.get(page) : undefined;
          if (!r) throw new Error(`unknown route: ${page}`);
          const nav = registry.navigateAdapter;
          if (!nav) throw new Error('no navigate adapter registered');
          nav(r.path);
          return { ok: true, page, path: r.path };
        },
      },
    });
  }

  const items = [...registry.draggables.values()];
  const zones = [...registry.dropzones.values()];
  if (items.length && zones.length) {
    const destructive = zones.some((z) => z.destructive !== false);
    specs.push({
      name: 'ui_drag_and_drop',
      descriptor: {
        name: 'ui_drag_and_drop',
        title: 'Drag and drop',
        description: 'Drag a declared item onto a declared drop zone.',
        inputSchema: {
          type: 'object',
          required: ['item', 'onto'],
          properties: { item: enumProp(items, 'Which item to drag.'), onto: enumProp(zones, 'Which zone to drop it on.') },
        },
        annotations: { title: 'Drag and drop', destructiveHint: destructive },
        execute: async (args: unknown) => {
          const { item, onto } = (args ?? {}) as { item?: string; onto?: string };
          const d = item ? registry.draggables.get(item) : undefined;
          const z = onto ? registry.dropzones.get(onto) : undefined;
          if (!d) throw new Error(`unknown item: ${item}`);
          if (!z) throw new Error(`unknown zone: ${onto}`);
          if (z.accepts && !z.accepts.includes(d.kind)) throw new Error(`zone ${onto} does not accept ${d.kind}`);
          await performDrag(d.el, z.el);
          return { ok: true, item, onto };
        },
      },
    });
  }

  return specs;
}

let installed = false;

export function installActionTools(ctx: ModelContextSurface): void {
  if (installed) return;
  installed = true;
  const current = new Map<string, AbortController>();

  const reconcile = (): void => {
    const specs = buildSpecs();
    const want = new Set(specs.map((s) => s.name));
    for (const [name, ac] of [...current]) {
      if (!want.has(name)) { ac.abort(); current.delete(name); }
    }
    for (const s of specs) {
      current.get(s.name)?.abort(); // drop stale schema, register fresh
      const ac = new AbortController();
      current.set(s.name, ac);
      ctx.registerTool(s.descriptor, { signal: ac.signal });
    }
  };

  subscribe(reconcile);
  reconcile();
}
