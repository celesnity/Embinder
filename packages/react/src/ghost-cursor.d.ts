import type { PhaseMessage } from './spotlight.js';
import type { EmbinderMotionPolicy } from './motion-policy.js';
export interface GhostCursor {
    handle(m: PhaseMessage): void;
    destroy(): void;
}
export declare function createGhostCursor(providedMotion?: EmbinderMotionPolicy): GhostCursor;
