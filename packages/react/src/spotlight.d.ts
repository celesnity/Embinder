import 'driver.js/dist/driver.css';
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
export declare function createSpotlight(decideBase?: string): Spotlight;
