/**
 * Grid-mode dot grid — a lightweight visual reference drawn *underneath* every element, which is why
 * it's a `StaticLayer` concern (behind the scene's own content) rather than the interactive layer's
 * overlay canvas (stacked visually *on top* of the static canvas — see `canvas-stage.ts`'s DOM
 * append order — where a grid would incorrectly paint over filled shapes instead of showing only in
 * the gaps around them).
 */
import type { Camera } from "./camera";
import { sceneToScreen, screenToScene } from "./camera";
import type { ViewportSize } from "./viewport-culling";

/** Narrow 2D-context surface this draw call needs. */
export interface GridDrawContext2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
}

const DOT_RADIUS_PX = 1;
const DOT_COLOR = "#c8c8c8";
/** Below this on-screen spacing between dots, the grid would render as visual noise rather than a useful reference — skip drawing entirely rather than paint a smear. */
const MIN_SCREEN_SPACING_PX = 6;

/**
 * Draws a dot at every `gridSize` (scene units) intersection currently visible through `camera`.
 * No-ops for a non-positive `gridSize` (grid disabled) or when the current zoom would pack dots
 * closer than `MIN_SCREEN_SPACING_PX` apart.
 */
export function drawGrid(ctx: GridDrawContext2D, camera: Camera, viewportSize: ViewportSize, gridSize: number): void {
  if (gridSize <= 0) return;
  if (gridSize * camera.zoom < MIN_SCREEN_SPACING_PX) return;

  const topLeft = screenToScene({ x: 0, y: 0 }, camera);
  const bottomRight = screenToScene({ x: viewportSize.width, y: viewportSize.height }, camera);
  const startX = Math.floor(topLeft.x / gridSize) * gridSize;
  const startY = Math.floor(topLeft.y / gridSize) * gridSize;

  ctx.fillStyle = DOT_COLOR;
  for (let sceneX = startX; sceneX <= bottomRight.x; sceneX += gridSize) {
    for (let sceneY = startY; sceneY <= bottomRight.y; sceneY += gridSize) {
      const screen = sceneToScreen({ x: sceneX, y: sceneY }, camera);
      ctx.fillRect(screen.x - DOT_RADIUS_PX, screen.y - DOT_RADIUS_PX, DOT_RADIUS_PX * 2, DOT_RADIUS_PX * 2);
    }
  }
}
