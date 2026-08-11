/**
 * Pure geometry for the rough.js dispatch: converts an element's scene-space bounding box (and, for
 * lines, its relative point list) into the screen-space coordinates rough.js's drawing calls need.
 * No rough.js import here — this file only computes numbers — kept separate from
 * `rough-style-mapping.ts` (style) and `rough-renderer.ts` (the actual rough.js calls) so all three
 * concerns are independently unit-testable without a canvas or the rough.js library itself.
 */
import type { AnyElement } from "../elements/element-types";
import type { PolygonShapeType } from "../elements/polygon-shape-geometry";
import { blockArrowUnitVertices, polygonShapeUnitVertices } from "../elements/polygon-shape-geometry";
import type { BlockArrowDirection, LineElement, RelativePoint } from "../elements/shape-elements";
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

/** Screen-space vertices of polygon shape `type` (diamond/triangle/hexagon/star) inscribed in `rect`, derived from the shared unit outline in `elements/polygon-shape-geometry.ts`. */
export function polygonShapeVertices(rect: ScreenRect, type: PolygonShapeType): Array<[number, number]> {
  return polygonShapeUnitVertices(type).map((point) => [rect.x + point.x * rect.width, rect.y + point.y * rect.height]);
}

/** Screen-space vertices of a block arrow pointing `direction`, inscribed in `rect`. */
export function blockArrowVertices(rect: ScreenRect, direction: BlockArrowDirection): Array<[number, number]> {
  return blockArrowUnitVertices(direction).map((point) => [rect.x + point.x * rect.width, rect.y + point.y * rect.height]);
}

/** Maps a unit-box fraction `(fx, fy)` to an absolute screen point within `rect` — the shared basis for the curve/composite shape paths below. */
function unitPoint(rect: ScreenRect, fx: number, fy: number): string {
  return `${rect.x + fx * rect.width} ${rect.y + fy * rect.height}`;
}

/** SVG path for a puffy cloud inscribed in `rect` — four cubic-bezier bumps around a closed loop. */
export function cloudPath(rect: ScreenRect): string {
  const p = (fx: number, fy: number) => unitPoint(rect, fx, fy);
  return [
    `M ${p(0.25, 0.75)}`,
    `C ${p(0.03, 0.75)} ${p(0.03, 0.48)} ${p(0.22, 0.44)}`,
    `C ${p(0.2, 0.18)} ${p(0.52, 0.14)} ${p(0.56, 0.34)}`,
    `C ${p(0.72, 0.16)} ${p(0.98, 0.28)} ${p(0.84, 0.5)}`,
    `C ${p(1.02, 0.56)} ${p(0.98, 0.8)} ${p(0.78, 0.75)}`,
    `Z`,
  ].join(" ");
}

/** SVG path for a heart inscribed in `rect` — two top lobes meeting at a bottom point. */
export function heartPath(rect: ScreenRect): string {
  const p = (fx: number, fy: number) => unitPoint(rect, fx, fy);
  return [
    `M ${p(0.5, 0.3)}`,
    `C ${p(0.5, 0.12)} ${p(0.1, 0.08)} ${p(0.1, 0.36)}`,
    `C ${p(0.1, 0.56)} ${p(0.36, 0.72)} ${p(0.5, 0.92)}`,
    `C ${p(0.64, 0.72)} ${p(0.9, 0.56)} ${p(0.9, 0.36)}`,
    `C ${p(0.9, 0.08)} ${p(0.5, 0.12)} ${p(0.5, 0.3)}`,
    `Z`,
  ].join(" ");
}

/** SVG path for a box with an X through it — the rect as a closed subpath plus its two diagonals (one Drawable; rough.js fills only the closed subpath). */
export function xBoxPath(rect: ScreenRect): string {
  const { x, y, width: w, height: h } = rect;
  return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z M ${x} ${y} L ${x + w} ${y + h} M ${x + w} ${y} L ${x} ${y + h}`;
}

/** SVG path for a box with a checkmark in it — the rect plus a check polyline (see `xBoxPath` on the single-Drawable trick). */
export function checkBoxPath(rect: ScreenRect): string {
  const { x, y, width: w, height: h } = rect;
  const rectPath = `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  const check = `M ${x + 0.26 * w} ${y + 0.52 * h} L ${x + 0.43 * w} ${y + 0.7 * h} L ${x + 0.74 * w} ${y + 0.3 * h}`;
  return `${rectPath} ${check}`;
}

/** SVG path for a database cylinder: an elliptical top cap over a tube with a bulging base (single Drawable). */
export function cylinderPath(rect: ScreenRect): string {
  const rx = rect.width / 2;
  const ry = Math.min(rect.height * 0.16, rect.width * 0.42);
  const left = rect.x;
  const right = rect.x + rect.width;
  const capY = rect.y + ry;
  const baseY = rect.y + rect.height - ry;
  return [
    `M ${left} ${capY}`,
    `A ${rx} ${ry} 0 0 1 ${right} ${capY}`, // top-back curve, bulging up over the cap
    `L ${right} ${baseY}`, // right wall
    `A ${rx} ${ry} 0 0 1 ${left} ${baseY}`, // base curve, bulging down
    "Z", // close the left wall
    `M ${left} ${capY}`,
    `A ${rx} ${ry} 0 0 0 ${right} ${capY}`, // front seam of the cap, bulging down
  ].join(" ");
}

/** SVG path for a double circle: an outer ellipse plus a concentric inner ring (single Drawable). */
export function doubleCirclePath(rect: ScreenRect): string {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const ring = (rx: number, ry: number): string =>
    `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  const inset = Math.min(rect.width, rect.height) * 0.12;
  return `${ring(rect.width / 2, rect.height / 2)} ${ring(rect.width / 2 - inset, rect.height / 2 - inset)}`;
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
