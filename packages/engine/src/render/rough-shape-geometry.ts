/**
 * Pure geometry for the rough.js dispatch: converts an element's scene-space bounding box (and, for
 * lines, its relative point list) into the screen-space coordinates rough.js's drawing calls need.
 * No rough.js import here — this file only computes numbers — kept separate from
 * `rough-style-mapping.ts` (style) and `rough-renderer.ts` (the actual rough.js calls) so all three
 * concerns are independently unit-testable without a canvas or the rough.js library itself.
 */
import type { AnyElement } from "../elements/element-types";
import type { LineElement, RelativePoint } from "../elements/shape-elements";
import type { Camera } from "./camera";
import { sceneToScreen } from "./camera";

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Converts `element`'s scene-space bounding box to screen space via `camera`. */
export function screenRectOf(element: Pick<AnyElement, "x" | "y" | "width" | "height">, camera: Camera): ScreenRect {
  const topLeft = sceneToScreen({ x: element.x, y: element.y }, camera);
  return { x: topLeft.x, y: topLeft.y, width: element.width * camera.zoom, height: element.height * camera.zoom };
}

/** The 4 vertices (top, right, bottom, left midpoints) of the diamond inscribed in `rect`, clockwise from top. */
export function diamondVertices(rect: ScreenRect): Array<[number, number]> {
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  return [
    [midX, rect.y],
    [rect.x + rect.width, midY],
    [midX, rect.y + rect.height],
    [rect.x, midY],
  ];
}

/** Fraction of `min(width, height)` used as the rounded-rectangle corner radius. */
const ROUNDNESS_RADIUS_RATIO = 0.25;
/** Upper bound (screen px) so a very large rectangle doesn't grow an absurdly large radius. */
const MAX_ROUNDNESS_RADIUS_PX = 32;

/**
 * SVG path `d` string for `rect` with rounded corners, for use with rough.js's `path()` generator —
 * rough.js has no built-in rounded-rectangle primitive, so a rounded rectangle is expressed as an
 * explicit path (straight edges, quadratic-curve corners) instead.
 */
export function roundedRectPath(rect: ScreenRect): string {
  const { x, y, width, height } = rect;
  const proportionalRadius = Math.max(0, Math.min(width, height) * ROUNDNESS_RADIUS_RATIO);
  const r = Math.min(proportionalRadius, MAX_ROUNDNESS_RADIUS_PX, width / 2, height / 2);
  return [
    `M ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height - r}`,
    `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `L ${x + r} ${y + height}`,
    `Q ${x} ${y + height} ${x} ${y + height - r}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

/** Converts a `LineElement`'s relative points to absolute screen-space coordinates via `camera`. */
export function lineScreenPoints(element: LineElement, camera: Camera): Array<[number, number]> {
  return element.points.map((point) => {
    const screen = sceneToScreen({ x: element.x + point.x, y: element.y + point.y }, camera);
    return [screen.x, screen.y];
  });
}

/** Float-safe equality tolerance for detecting a deliberately-repeated closing vertex. */
const CLOSE_EPSILON = 1e-6;

/**
 * True when `points` (a `LineElement`'s relative vertex list) forms a closed loop — the first
 * vertex repeated as the last — per `LineElement.points`'s doc. Requires at least 3 vertices before
 * the repeat: a 2-point "loop" (A, A) has no area and isn't a meaningful polygon.
 */
export function isClosedPolyline(points: readonly RelativePoint[]): boolean {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return false;
  return Math.abs(first.x - last.x) < CLOSE_EPSILON && Math.abs(first.y - last.y) < CLOSE_EPSILON;
}
