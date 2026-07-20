export interface GhostController {
    /** Move the mascot's finger-tip to a viewport point (px). */
    driveTo(x: number, y: number): void;
    /** Hand control back to idle wandering. */
    release(): void;
}
export declare function setGhostController(c: GhostController | undefined): void;
export declare function getGhostController(): GhostController | undefined;
