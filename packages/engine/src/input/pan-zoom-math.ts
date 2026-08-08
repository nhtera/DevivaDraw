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
