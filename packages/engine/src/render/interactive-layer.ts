/**
 * Interactive layer: the overlay canvas that will hold selection outlines, resize handles, and
 * remote cursors — content that must repaint every frame/pointer-move a gesture is active, unlike
 * the static layer's cached scene. This phase only proves the surface exists and clears cleanly;
 * real overlay content lands once selection exists (a later phase).
 */
import type { Camera } from "./camera";

/** Minimal 2D-context surface this layer needs; a real `CanvasRenderingContext2D` satisfies it. */
export interface InteractiveLayerContext {
  readonly canvas: { clientWidth: number; clientHeight: number };
  clearRect(x: number, y: number, width: number, height: number): void;
}

/** No fields yet — populated once selection/resize-handle/cursor state exists (later phase). */
export type OverlayState = Record<string, never>;

export class InteractiveLayer {
  private readonly ctx: InteractiveLayerContext;

  constructor(ctx: InteractiveLayerContext) {
    this.ctx = ctx;
  }

  /**
   * Clears the overlay and (for now) draws nothing else. Takes `overlayState`/`camera` already so
   * the call signature doesn't need to change when real overlay content is added.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- params kept for a stable render() signature; both used once selection overlay content lands
  render(overlayState: OverlayState, camera: Camera): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.clientWidth, this.ctx.canvas.clientHeight);
  }
}
