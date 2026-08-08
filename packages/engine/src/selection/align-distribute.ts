/**
 * Align (6 ways) and distribute (H/V) pixel math for a multi-select — pure functions over each
 * element's own unrotated `x/y/width/height` (aligning/distributing by a rotated element's *storage*
 * box, not its rotated footprint, matches every whiteboard app of this genre: the edges being lined
 * up are the ones the user thinks of as the shape's box, not its rotated silhouette). `Scene`-free so
 * the pixel math is independently unit-testable; `selection-tool.ts` turns the returned `{id,
 * changes}` pairs into `Scene.updateElement` calls inside one history batch.
 */
import type { ElementTransformResult } from "./group-transform";
import { selectionBoundsOf } from "./selection-geometry";

export type AlignEdge = "left" | "center-h" | "right" | "top" | "middle-v" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

export interface AlignableElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  isDeleted: boolean;
}

/** Aligning fewer than 2 elements has nothing to align relative to; returns `[]` rather than a no-op single-element "change". */
export function computeAlignChanges(elements: readonly AlignableElement[], edge: AlignEdge): ElementTransformResult[] {
  if (elements.length < 2) return [];
  const bounds = selectionBoundsOf(elements);
  if (!bounds) return [];

  return elements.map((element) => {
    switch (edge) {
      case "left":
        return { id: element.id, changes: { x: bounds.x } };
      case "right":
        return { id: element.id, changes: { x: bounds.x + bounds.width - element.width } };
      case "center-h":
        return { id: element.id, changes: { x: bounds.x + (bounds.width - element.width) / 2 } };
      case "top":
        return { id: element.id, changes: { y: bounds.y } };
      case "bottom":
        return { id: element.id, changes: { y: bounds.y + bounds.height - element.height } };
      case "middle-v":
        return { id: element.id, changes: { y: bounds.y + (bounds.height - element.height) / 2 } };
    }
  });
}

/**
 * Spaces elements evenly along `axis` by edge-to-edge gap (not center-to-center), keeping the
 * extreme (first/last, by position) elements fixed and repositioning only the interior ones. Fewer
 * than 3 elements has nothing meaningful to distribute (2 elements have exactly one gap already) and
 * returns `[]`.
 */
export function computeDistributeChanges(elements: readonly AlignableElement[], axis: DistributeAxis): ElementTransformResult[] {
  if (elements.length < 3) return [];

  const sizeOf = (el: AlignableElement) => (axis === "horizontal" ? el.width : el.height);
  const posOf = (el: AlignableElement) => (axis === "horizontal" ? el.x : el.y);
  const sorted = [...elements].sort((a, b) => posOf(a) - posOf(b));

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = posOf(last) + sizeOf(last) - posOf(first);
  const totalSize = sorted.reduce((sum, el) => sum + sizeOf(el), 0);
  const gapCount = sorted.length - 1;
  const gap = (span - totalSize) / gapCount;

  const results: ElementTransformResult[] = [];
  let cursor = posOf(first) + sizeOf(first) + gap;
  for (let i = 1; i < sorted.length - 1; i += 1) {
    const element = sorted[i]!;
    results.push({ id: element.id, changes: axis === "horizontal" ? { x: cursor } : { y: cursor } });
    cursor += sizeOf(element) + gap;
  }
  return results;
}
