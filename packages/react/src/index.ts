// @embinder/react — app-side SDK. The public surface is the pointer primitive:
// drop useEmbinder on a component and the agent sees + operates it while it's on screen.

export { EmbinderProvider } from './provider.js';
export type { EmbinderProviderProps } from './provider.js';

// The pointer primitive: declare + anchor + lifecycle in one call.
export { useEmbinder } from './use-embinder.js';
export type { EmbinderDescriptor, EmbinderBind } from './use-embinder.js';
export { getModelContext } from './model-context.js';
export type { ToolDescriptor, ModelContextSurface } from './model-context.js';

export type { ChatBubbleConfig } from './chat/ChatBubble.js';
