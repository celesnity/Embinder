// Named scroll targets the agent can drive the user to. `id` is the DOM anchor
// used both for scrollIntoView and as the grabAnchor tool element for the spotlight.
import type { Page } from './store';

export interface Section {
  id: string;
  page: Page;
  title: string;
}

export const SECTIONS: Section[] = [
  { id: 'board-top', page: 'board', title: 'Board — top' },
  { id: 'overview', page: 'analytics', title: 'Analytics — overview' },
  { id: 'by-priority', page: 'analytics', title: 'Analytics — priority breakdown' },
  { id: 'by-column', page: 'analytics', title: 'Analytics — column throughput' },
  { id: 'activity', page: 'analytics', title: 'Analytics — recent activity' },
  { id: 'archive-list', page: 'archive', title: 'Archive — archived tasks' },
  { id: 'columns-manager', page: 'settings', title: 'Settings — columns manager' },
  { id: 'data', page: 'settings', title: 'Settings — import / export' },
  { id: 'danger-zone', page: 'settings', title: 'Settings — danger zone' },
];

export const sectionById = (id: string) => SECTIONS.find((s) => s.id === id);
