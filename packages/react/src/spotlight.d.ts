import 'driver.js/dist/driver.css';
import type { EmbinderMotionPolicy } from './motion-policy.js';
export interface PhaseMessage {
    type: 'intent' | 'gate' | 'decided' | 'call' | 'done' | 'focus';
    id?: string;
    name?: string;
    argsPreview?: unknown;
    scopeId?: string;
    status?: 'auto' | 'awaiting';
    decision?: 'approved' | 'denied';
}
export interface Spotlight {
    handle(m: PhaseMessage): void;
    destroy(): void;
}
export declare function createSpotlight(decideBase?: string, providedMotion?: EmbinderMotionPolicy): Spotlight;
