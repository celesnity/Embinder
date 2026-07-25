import { type ReactNode } from 'react';
import type { EmbinderMotionMode } from './motion-policy.js';
export declare function sendEmbinderContext(name: string, state: unknown): void;
export declare function registerEmbinderScope(scope: {
    id: string;
    parentId?: string;
    name: string;
}): void;
export declare function sendEmbinderScopeContext(id: string, state: unknown): void;
export declare function unregisterEmbinderScope(id: string): void;
export interface EmbinderProviderProps {
    children: ReactNode;
    /** Relay ws endpoint. Default ws://127.0.0.1:7331/app */
    url?: string;
    /** Optional explicit ws token (otherwise fetched from the relay, T-G1). */
    token?: string;
    /** T-K: enable the agent-action spotlight + gate visualization (D7 polish, off by default). */
    viz?: boolean;
    /** Mascot and spotlight motion. `system` respects `prefers-reduced-motion` (the default). */
    motion?: EmbinderMotionMode;
    /**
     * The resident agent bubble. Mounted by DEFAULT (D-9) — config comes from the relay's
     * /chat-config (env). Pass a config object to override, or `false` to opt out
     * (opt-out keeps the bubble code out of the bundle entirely).
     */
    chat?: import('./chat/ChatBubble.js').ChatBubbleConfig | false;
}
export declare function EmbinderProvider({ children, url, token, viz, motion, chat }: EmbinderProviderProps): import("react").JSX.Element;
