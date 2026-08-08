/**
 * Camera model + scene↔screen coordinate transforms.
 *
 * The camera describes the current viewport as a scene-space scroll offset plus a zoom factor.
 * `sceneToScreen`/`screenToScene` are the *only* place this math is allowed to live — every later
 * phase (pointer hit-testing in input, selection outlines, export-to-image) must import and reuse
 * these two functions rather than re-deriving the transform, so a sign or DPR mistake gets fixed
 * once instead of hunted down independently in three different phases.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  /**
   * Scene-space offset added to a point before scaling to screen space. The scene coordinate
   * currently sitting at the screen origin is therefore `(-scrollX, -scrollY)`.
   */
  scrollX: number;
  scrollY: number;
  /** Scale factor applied after the scroll offset; `1` = 100%. Always clamp via `clampZoom`. */
  zoom: number;
}

/** Product spec zoom range: 10%–3000%. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

/** Clamps a candidate zoom level to the supported `[MIN_ZOOM, MAX_ZOOM]` range. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Builds a camera centered at the scene origin, 100% zoom, unless overridden. */
export function createCamera(overrides: Partial<Camera> = {}): Camera {
  return { scrollX: 0, scrollY: 0, zoom: 1, ...overrides };
}

/** Converts a scene-space point to screen-space (canvas CSS-pixel) coordinates. */
export function sceneToScreen(point: Point, camera: Camera): Point {
  return {
    x: (point.x + camera.scrollX) * camera.zoom,
    y: (point.y + camera.scrollY) * camera.zoom,
  };
}

/** Converts a screen-space (canvas CSS-pixel) point back to scene-space coordinates. */
export function screenToScene(point: Point, camera: Camera): Point {
  return {
    x: point.x / camera.zoom - camera.scrollX,
    y: point.y / camera.zoom - camera.scrollY,
  };
}
