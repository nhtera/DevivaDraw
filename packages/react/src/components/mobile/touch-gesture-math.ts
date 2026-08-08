/**
 * Pure two-finger pinch-zoom/pan math — no DOM, fully unit-testable. `touch-gesture-adapter.ts`
 * (untested, DOM-only per this package's established trade-off) is the thin listener wiring that
 * feeds live touch coordinates through these functions each `pointermove`. Additive to, not a
 * replacement of, `@deviva-draw/engine`'s single-pointer `PointerEventPipeline` gesture model (this
 * phase's Key Insight): the adapter only ever activates once a *second* touch appears.
 */
import { clampZoom, zoomCameraAtScreenPoint } from "@deviva-draw/engine";
import type { Camera, Point } from "@deviva-draw/engine";

/** Midpoint of every tracked touch — the anchor pinch-zoom keeps fixed on screen and two-finger pan follows. */
export function touchCentroid(points: readonly Point[]): Point {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Average distance from the centroid — a stable "how far apart are the fingers" scalar that generalizes past exactly 2 touches without a special case. */
export function touchSpread(points: readonly Point[]): number {
  if (points.length < 2) return 0;
  const centroid = touchCentroid(points);
  return points.reduce((sum, point) => sum + Math.hypot(point.x - centroid.x, point.y - centroid.y), 0) / points.length;
}

/**
 * Applies one incremental two-finger gesture step to `camera`: `panDeltaX`/`panDeltaY` (screen px,
 * this move's centroid movement since the last tracked move) pan the camera so scene content follows
 * the fingers (the natural touch-drag convention — the *opposite* sign of wheel-scroll's convention;
 * see `pan-zoom-math.ts`'s `panCameraByScreenDelta` doc for that contrast), then `scaleFactor` (this
 * move's spread ÷ the last tracked spread) rezooms anchored at `centroidScreenPoint` so the pinch
 * feels centered under the fingers rather than the viewport's corner. Recomputed incrementally from
 * the *live* camera on every move (not a frozen gesture-start snapshot) — mirrors
 * `pan-zoom-tool.ts`'s own drag-pan tool, which updates its "last point" the same way; a single-frame
 * incremental delta is simpler and avoids any need to reconcile a moved anchor against a stale one.
 */
export function computeTouchPanZoomCamera(camera: Camera, panDeltaX: number, panDeltaY: number, centroidScreenPoint: Point, scaleFactor: number): Camera {
  const panned: Camera = {
    ...camera,
    scrollX: camera.scrollX + panDeltaX / camera.zoom,
    scrollY: camera.scrollY + panDeltaY / camera.zoom,
  };
  const targetZoom = clampZoom(panned.zoom * scaleFactor);
  return zoomCameraAtScreenPoint(panned, centroidScreenPoint, targetZoom);
}
