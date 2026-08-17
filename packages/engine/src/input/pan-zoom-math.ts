/**
 * Pure camera math for pan/zoom — no DOM, no tool/gesture state, fully unit-testable with known
 * values. Split out from `pan-zoom-tool.ts` (which wraps this in the stateful `ToolHandler` +
 * wheel/keyboard-driven convenience methods) purely to keep each file small and each concern
 * independently testable.
 */
import type { Camera, Point } from "../render/camera";
import { clampZoom, screenToScene } from "../render/camera";
import type { SceneRect, ViewportSize } from "../render/viewport-culling";

/**
 * Re-solves scroll so the scene point currently under `screenPoint` stays fixed on screen after
 * rezooming to `targetZoom` — the "zoom centered on the cursor" feel. Zooming around the scene
 * origin instead (i.e. not compensating scroll) would make every zoom step also visibly shift the
 * canvas, which is the wrong feel for a whiteboard.
 */
export function zoomCameraAtScreenPoint(camera: Camera, screenPoint: Point, targetZoom: number): Camera {
  const zoom = clampZoom(targetZoom);
  const sceneUnderCursorBefore = screenToScene(screenPoint, camera);
  const sceneUnderCursorAfter = screenToScene(screenPoint, { ...camera, zoom });
  return {
    zoom,
    scrollX: camera.scrollX + (sceneUnderCursorAfter.x - sceneUnderCursorBefore.x),
    scrollY: camera.scrollY + (sceneUnderCursorAfter.y - sceneUnderCursorBefore.y),
  };
}

/**
 * Pans by a raw screen-space delta (wheel `deltaX`/`deltaY`), zoom-compensated so a fixed screen
 * distance of wheel movement always pans the same screen distance regardless of current zoom.
 */
export function panCameraByScreenDelta(camera: Camera, deltaX: number, deltaY: number): Camera {
  return {
    ...camera,
    scrollX: camera.scrollX - deltaX / camera.zoom,
    scrollY: camera.scrollY - deltaY / camera.zoom,
  };
}

/**
 * Camera that frames `bounds` (scene-space) inside `viewport`, leaving `padding` screen px of
 * margin on every side. Returns `camera` unchanged when `bounds` is `null` or has no area (empty
 * scene, or a zoom-to-selection stub with nothing selected) — there is nothing meaningful to fit.
 */
export function computeZoomToFitCamera(
  camera: Camera,
  bounds: SceneRect | null,
  viewport: ViewportSize,
  padding = 32,
): Camera {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return camera;

  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(Math.min(availableWidth / bounds.width, availableHeight / bounds.height));

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    zoom,
    scrollX: viewport.width / 2 / zoom - centerX,
    scrollY: viewport.height / 2 / zoom - centerY,
  };
}

/**
 * The camera that brings `rect` into view: centred, at the current zoom unless the rect would not
 * fit within 80% of the viewport, in which case it zooms out just enough to fit. Never zooms *in*,
 * so stepping between targets does not lurch the magnification around.
 *
 * Extracted from `PanZoomTool.revealRect` (which is now a thin wrapper) so a caller that wants to
 * *animate* toward the same destination — the presentation walk — can compute the target camera
 * without reimplementing the fit math and drifting from it.
 */
export function computeRevealRectCamera(camera: Camera, rect: SceneRect, viewport: ViewportSize): Camera {
  const fitZoom = Math.min((viewport.width * 0.8) / Math.max(rect.width, 1), (viewport.height * 0.8) / Math.max(rect.height, 1));
  const zoom = clampZoom(Math.min(camera.zoom, fitZoom));
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return { zoom, scrollX: viewport.width / (2 * zoom) - centerX, scrollY: viewport.height / (2 * zoom) - centerY };
}

/** `zoom` clamped into the product range, with non-finite/non-positive input falling back to the minimum rather than poisoning the arithmetic — see `interpolateCamera`. */
function usableZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? clampZoom(zoom) : clampZoom(Number.MIN_VALUE);
}

/**
 * Ease-in-out cubic on `t` (clamped to `0..1`) — the standard "accelerate away, settle in" curve.
 * A camera move that starts and stops abruptly reads as a jump-cut; easing is what makes a slide
 * transition legible as movement rather than teleportation.
 */
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/**
 * Camera `progress` of the way from `from` to `to`.
 *
 * Zoom is interpolated geometrically (exponentially), not linearly: zoom is a multiplicative scale,
 * so a linear walk from 0.1 to 2 spends most of its time near the high end and the move looks like
 * it decelerates hard at the start regardless of easing. Interpolating the logarithm makes each
 * frame a constant *ratio* step, which is what reads as an even zoom.
 *
 * Both zooms are sanitized to a usable positive value BEFORE the ratio is taken. A non-positive or
 * non-finite `from.zoom` would otherwise make the ratio `Infinity` and the product
 * `0 * Infinity = NaN` — and `clampZoom` alone does not rescue that, since `Math.min(max,
 * Math.max(min, NaN))` is `NaN`: the result would be a blank canvas with no error anywhere. Every
 * caller today arrives with an already-clamped camera, but this is an exported pure function and
 * must not depend on its callers being disciplined.
 */
export function interpolateCamera(from: Camera, to: Camera, progress: number): Camera {
  const t = Math.min(1, Math.max(0, progress));
  const fromZoom = usableZoom(from.zoom);
  const toZoom = usableZoom(to.zoom);
  return {
    zoom: clampZoom(fromZoom * Math.pow(toZoom / fromZoom, t)),
    scrollX: from.scrollX + (to.scrollX - from.scrollX) * t,
    scrollY: from.scrollY + (to.scrollY - from.scrollY) * t,
  };
}

/**
 * Axis-aligned union bounding box of every non-deleted element, or `null` if none remain. Ignores
 * rotation like `viewport-culling.ts`'s own AABB test does — over-including a rotated element's
 * footprint is the safe direction here too (fitting slightly wider than strictly necessary, never
 * cropping content out of view).
 */
export function computeElementsBounds(
  elements: Iterable<{ x: number; y: number; width: number; height: number; isDeleted: boolean }>,
): SceneRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const element of elements) {
    if (element.isDeleted) continue;
    found = true;
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + element.height);
  }

  return found ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}
