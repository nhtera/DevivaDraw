/**
 * The single source of truth for the vertex outline of every polygon-based bounding-box shape
 * (diamond, triangle, hexagon, star). Vertices are returned in *unit* space — fractions of the
 * shape's bounding box, `(0,0)` top-left to `(1,1)` bottom-right — so both the renderer
 * (`render/rough-shape-geometry.ts`, scaling into screen space) and hit testing
 * (`selection/hit-test.ts`, scaling into the element's local space) derive their geometry from one
 * place and can never drift apart. Winding is clockwise from the top for every shape.
 */
import type { BlockArrowDirection, RelativePoint } from "./shape-elements";

/** Element `type` strings whose outline is a closed polygon computed from the bounding box alone. */
export type PolygonShapeType = "diamond" | "triangle" | "hexagon" | "star";

/** True for the element types `polygonShapeUnitVertices` can outline — a narrowing guard for callers dispatching on `element.type`. */
export function isPolygonShapeType(type: string): type is PolygonShapeType {
  return type === "diamond" || type === "triangle" || type === "hexagon" || type === "star";
}

/** Points of a 5-pointed star as unit-box fractions: 10 alternating outer/inner vertices around the box center, first outer point at the top. */
function starUnitVertices(): RelativePoint[] {
  const cx = 0.5;
  const cy = 0.5;
  const outer = 0.5;
  // Classic pentagram inner/outer ratio — slim enough to read as a star, not a decagon.
  const inner = 0.5 * 0.382;
  const points: RelativePoint[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    // Start at the top (-90°) and step 36° per vertex.
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

/**
 * The 7 unit-box vertices of a block (geo) arrow pointing `direction` — a rectangular shaft with a
 * triangular head. The right-pointing outline is authored explicitly; the other three are derived by
 * mirroring/transposing its coordinates, so all four stay in exact proportion.
 */
export function blockArrowUnitVertices(direction: BlockArrowDirection): RelativePoint[] {
  // Right-pointing: shaft occupies the left, the head fans out on the right.
  const right: RelativePoint[] = [
    { x: 0, y: 0.3 },
    { x: 0.6, y: 0.3 },
    { x: 0.6, y: 0.1 },
    { x: 1, y: 0.5 },
    { x: 0.6, y: 0.9 },
    { x: 0.6, y: 0.7 },
    { x: 0, y: 0.7 },
  ];
  switch (direction) {
    case "right":
      return right;
    case "left":
      return right.map((p) => ({ x: 1 - p.x, y: p.y }));
    case "down":
      return right.map((p) => ({ x: p.y, y: p.x }));
    case "up":
      return right.map((p) => ({ x: p.y, y: 1 - p.x }));
  }
}

/** The closed outline of `type` as unit-box fractions (see module doc). */
export function polygonShapeUnitVertices(type: PolygonShapeType): RelativePoint[] {
  switch (type) {
    case "diamond":
      return [
        { x: 0.5, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.5, y: 1 },
        { x: 0, y: 0.5 },
      ];
    case "triangle":
      return [
        { x: 0.5, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
    case "hexagon":
      // Flat-top hexagon inscribed in the box.
      return [
        { x: 0.25, y: 0 },
        { x: 0.75, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.75, y: 1 },
        { x: 0.25, y: 1 },
        { x: 0, y: 0.5 },
      ];
    case "star":
      return starUnitVertices();
  }
}
