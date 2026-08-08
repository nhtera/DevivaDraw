/**
 * Viewport culling: decides which elements are worth handing to the draw dispatch at all.
 *
 * Kept as pure functions over plain data (a scene rect, an element's bounding box) so this is
 * fully unit-testable without a real canvas — `getVisibleElements` is the only piece that touches
 * `Scene`, and it's a thin composition of `getVisibleSceneRect` + `elementIntersectsRect`.
 */
import type { AnyElement } from "../elements/element-types";
import type { Scene } from "../scene/scene";
import type { Camera } from "./camera";
import { screenToScene } from "./camera";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface SceneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Computes the scene-space rectangle currently visible through `camera` at `viewportSize`. */
export function getVisibleSceneRect(camera: Camera, viewportSize: ViewportSize): SceneRect {
  const topLeft = screenToScene({ x: 0, y: 0 }, camera);
  const bottomRight = screenToScene({ x: viewportSize.width, y: viewportSize.height }, camera);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/**
 * AABB intersection between an element's untransformed bounding box and a scene rect. `angle`
 * (rotation) is intentionally ignored: an axis-aligned test over-includes a rotated element's
 * true footprint at worst, never under-culls it into missing pixels — the safe direction for a
 * culling optimization. Tightening this to the rotated OBB is a later, profiling-driven change.
 */
export function elementIntersectsRect(
  element: Pick<AnyElement, "x" | "y" | "width" | "height">,
  rect: SceneRect,
): boolean {
  return (
    element.x < rect.x + rect.width &&
    element.x + element.width > rect.x &&
    element.y < rect.y + rect.height &&
    element.y + element.height > rect.y
  );
}

/**
 * Filters an already-fetched element list down to the non-deleted, in-viewport subset, preserving
 * input order. Split out from `getVisibleElements` so a caller that already has a `Scene.getElements()`
 * result (e.g. the static layer's draw pass) can reuse it instead of paying for a second sorted copy.
 */
export function filterVisibleElements(
  elements: readonly AnyElement[],
  camera: Camera,
  viewportSize: ViewportSize,
): AnyElement[] {
  const rect = getVisibleSceneRect(camera, viewportSize);
  return elements.filter((element) => !element.isDeleted && elementIntersectsRect(element, rect));
}

/**
 * Returns the non-deleted elements of `scene` whose bounding box intersects the visible viewport,
 * in the same z-order `Scene.getElements()` returns them — the draw dispatch relies on that order.
 */
export function getVisibleElements(scene: Scene, camera: Camera, viewportSize: ViewportSize): AnyElement[] {
  return filterVisibleElements(scene.getElements(), camera, viewportSize);
}
