/**
 * Free-form ("lasso") selection query: which elements a hand-drawn loop encloses. Unlike the
 * rectangular marquee (`marquee-select.ts`), the selection region is an arbitrary polygon the user
 * traced. An element counts as lassoed when its rotation-aware footprint is caught by the loop —
 * either its center or any of its corners falls inside the polygon — the forgiving "touch to grab"
 * behavior tldraw/Excalidraw's lasso uses, rather than requiring the whole shape be enclosed.
 * Same exclusions as the marquee: deleted, locked, and bound-text elements never participate.
 */
import type { AnyElement } from "../elements/element-types";
import type { Point } from "../render/camera";
import { pointInPolygon } from "./polygon-hit-math";
import { rotatedCorners } from "./selection-geometry";

/** Non-deleted, non-locked, non-bound-text elements from `elements` whose center or any corner falls inside `polygon` (a closed loop of ≥3 scene-space points). */
export function elementsInLasso(elements: readonly AnyElement[], polygon: readonly Point[]): AnyElement[] {
  if (polygon.length < 3) return [];
  return elements.filter((element) => {
    if (element.isDeleted || element.locked) return false;
    if (element.type === "text" && element.containerId !== null) return false;
    const corners = rotatedCorners(element);
    const center = { x: (corners[0]!.x + corners[2]!.x) / 2, y: (corners[0]!.y + corners[2]!.y) / 2 };
    return pointInPolygon(center, polygon) || corners.some((corner) => pointInPolygon(corner, polygon));
  });
}
