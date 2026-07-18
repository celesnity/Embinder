// @embinder/react — app-side SDK. The public surface is the pointer primitive:
// drop useEmbinder on a component and the agent sees + operates it while it's on screen.

export { EmbinderProvider } from './provider.js';
export type { EmbinderProviderProps } from './provider.js';

// The pointer primitive: declare + anchor + lifecycle in one call.
export { useEmbinder } from './use-embinder.js';
export type { EmbinderDescriptor, EmbinderBind } from './use-embinder.js';
export { getModelContext } from './model-context.js';
export type { ToolDescriptor, ModelContextSurface } from './model-context.js';

// Anchor an existing element to an already-registered tool (declared via useEmbinder or
// useBoardTools). Returns the same data attribute the pointer primitive spreads, so the
// spotlight can highlight the element when the agent invokes that tool. Static, no lifecycle.
export function grabAnchor(name: string): { 'data-embinder-tool': string } {
  return { 'data-embinder-tool': name };
}

// Agent-driven UI action helpers (drag / drop / scroll / routing).
export { useScrollTarget } from './actions/useScrollTarget.js';
export type { ScrollTargetConfig } from './actions/useScrollTarget.js';
export { useRoute } from './actions/useRoute.js';
export { useDraggable, EMBINDER_DND_MIME } from './actions/useDraggable.js';
export type { DraggableConfig } from './actions/useDraggable.js';
export { useDropZone } from './actions/useDropZone.js';
export type { DropZoneConfig } from './actions/useDropZone.js';

export type { ChatBubbleConfig } from './chat/ChatBubble.js';

// Agent-aware wrapper components (declarative override of native elements).
export { AgentButton } from './components/AgentButton.js';
export type { AgentButtonProps } from './components/AgentButton.js';
