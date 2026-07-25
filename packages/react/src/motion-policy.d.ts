export type EmbinderMotionMode = 'system' | 'full' | 'reduced' | 'off';
export interface EmbinderMotionPolicy {
    readonly mode: EmbinderMotionMode;
    readonly reduced: boolean;
    readonly hidden: boolean;
    subscribe(listener: (reduced: boolean) => void): () => void;
    destroy(): void;
}
export declare function createEmbinderMotionPolicy(mode?: EmbinderMotionMode): EmbinderMotionPolicy;
