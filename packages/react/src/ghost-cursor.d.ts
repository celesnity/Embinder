import type { PhaseMessage } from './spotlight.js';
export interface GhostCursor {
    handle(m: PhaseMessage): void;
    destroy(): void;
}
export declare function createGhostCursor(): GhostCursor;
