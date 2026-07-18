// Decouples the synthesis engine from the ghost cursor. The cursor registers a
// controller when viz is on; synthesis drives it if present, else runs headless.
export interface GhostController {
  /** Move the mascot's finger-tip to a viewport point (px). */
  driveTo(x: number, y: number): void;
  /** Hand control back to idle wandering. */
  release(): void;
}

let controller: GhostController | undefined;

export function setGhostController(c: GhostController | undefined): void { controller = c; }
export function getGhostController(): GhostController | undefined { return controller; }
