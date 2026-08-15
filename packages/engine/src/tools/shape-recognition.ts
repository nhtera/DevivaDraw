/**
 * "Draw to shape" (Excalidraw's Shift+X): classify a rough freehand stroke and rebuild it as a clean
 * shape at the same bounds. A geometry heuristic, no ML: simplify the stroke (Ramer–Douglas–Peucker),
 * then decide from openness + corner count + corner placement. Open ~straight → line; closed 3 corners
 * → triangle; 4 corners → rectangle or diamond (by whether corners sit at the box corners or the edge
 * midpoints); 5+/smooth → ellipse. Returns `null` when nothing confident matches (the caller keeps the
 * freehand stroke). The replacement inherits the stroke's style so it looks like the same drawing.
 */
import type { AnyElement } from "../elements/element-types";
import type { FreedrawElement } from "../elements/freedraw-element";
import { createDiamondElement, createEllipseElement, createLineElement, createRectangleElement, createTriangleElement } from "../elements/shape-elements";

interface Pt {
  x: number;
  y: number;
}

export type RecognizedShape = "rectangle" | "ellipse" | "diamond" | "triangle" | "line";

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Perpendicular distance from `p` to the segment `a`–`b`. */
function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return dist(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Ramer–Douglas–Peucker polyline simplification. */
function simplify(points: readonly Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return [...points];
  let maxDist = 0;
  let index = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

function boundsOf(points: readonly Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** True if the closed shape's corners sit nearer the box's edge midpoints than its corners (a diamond). */
function looksLikeDiamond(corners: readonly Pt[], b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  const boxCorners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const midpoints = [
    { x: cx, y: b.minY },
    { x: b.maxX, y: cy },
    { x: cx, y: b.maxY },
    { x: b.minX, y: cy },
  ];
  let midWins = 0;
  for (const corner of corners) {
    const dCorner = Math.min(...boxCorners.map((c) => dist(corner, c)));
    const dMid = Math.min(...midpoints.map((m) => dist(corner, m)));
    if (dMid < dCorner) midWins++;
  }
  return midWins > corners.length / 2;
}

/** Classifies the stroke's `points` (in any consistent coordinate space) into a clean shape, or `null` if none is confident. */
export function classifyStroke(points: readonly Pt[]): RecognizedShape | null {
  if (points.length < 3) return null;
  const b = boundsOf(points);
  const diagonal = Math.hypot(b.width, b.height);
  if (diagonal < 12) return null; // too small to classify meaningfully

  const gap = dist(points[0]!, points[points.length - 1]!);
  const closed = gap < 0.3 * diagonal;
  const simplified = simplify(points, 0.07 * diagonal);

  if (!closed) {
    return simplified.length <= 2 ? "line" : null; // only "clean up" a roughly straight open stroke
  }

  // Closed: the simplified loop repeats its start point, so corner count is vertices − 1.
  const corners = simplified.slice(0, -1);
  const cornerCount = corners.length;
  if (cornerCount <= 2) return "ellipse"; // a smooth closed blob simplifies to very few vertices
  if (cornerCount === 3) return "triangle";
  if (cornerCount === 4) return looksLikeDiamond(corners, b) ? "diamond" : "rectangle";
  return "ellipse";
}

/**
 * Recognizes `element`'s freehand stroke and returns a clean replacement element at the same bounds
 * (inheriting its style), or `null` to keep the original. `element.points` are element-relative
 * (`[x, y, pressure]`); the returned element is positioned in absolute scene space.
 */
export function recognizeFreedrawShape(element: FreedrawElement): AnyElement | null {
  const points: Pt[] = element.points.map(([x, y]) => ({ x, y }));
  const shape = classifyStroke(points);
  if (!shape) return null;

  const b = boundsOf(points);
  const style = {
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    fillStyle: element.fillStyle,
    strokeWidth: element.strokeWidth,
    strokeStyle: element.strokeStyle,
    roughness: element.roughness,
    opacity: element.opacity,
    roundness: element.roundness,
    seed: element.seed,
    angle: element.angle,
    groupIds: [...element.groupIds],
    frameId: element.frameId,
    locked: element.locked,
    // The replacement shape stays on the stroke's layer — without this, recognizing after switching
    // the active layer would silently re-home the result via addElement's stamping.
    ...(element.layerId !== undefined ? { layerId: element.layerId } : {}),
    link: element.link,
  };
  const x = element.x + b.minX;
  const y = element.y + b.minY;

  if (shape === "line") {
    const start = points[0]!;
    const end = points[points.length - 1]!;
    return createLineElement({
      ...style,
      x: element.x + start.x,
      y: element.y + start.y,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      points: [
        { x: 0, y: 0 },
        { x: end.x - start.x, y: end.y - start.y },
      ],
    });
  }

  const geom = { ...style, x, y, width: b.width, height: b.height };
  switch (shape) {
    case "rectangle":
      return createRectangleElement(geom);
    case "ellipse":
      return createEllipseElement(geom);
    case "diamond":
      return createDiamondElement(geom);
    case "triangle":
      return createTriangleElement(geom);
  }
}
