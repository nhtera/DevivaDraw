/**
 * Mirrors a selection across its own bounding box — left↔right for a horizontal flip, top↔bottom for a
 * vertical one. Pure `{id, changes}` math in the same shape as `align-distribute.ts`; the caller
 * applies the pairs inside one history batch.
 *
 * Three kinds of element mirror three different ways:
 *  - **Point geometry** (line, arrow, freedraw) mirrors exactly: every vertex is reflected within the
 *    element's own point bounds, so the drawn path really is its mirror image.
 *  - **Block arrows** swap the `direction` they point in — the same mirror, expressed in the one field
 *    that carries their orientation.
 *  - **Bounding-box shapes** have no mirrored variant of their outline to switch to, so one that is
 *    asymmetric about the flip axis is turned by half a turn instead, which is exactly what a mirror
 *    amounts to for a shape symmetric about the *other* axis (a triangle flipped vertically points
 *    down). `elements/shape-outline-symmetry.ts` records which shapes those are, and which are
 *    symmetric about neither axis and can therefore only move.
 *
 * Every element's own `angle` is negated regardless: mirroring a rotated element mirrors its rotation.
 * Text and images keep their content upright — a flip that rendered a label as mirror writing is not
 * what anyone means by the word, and this app's image element carries no mirror flag of its own.
 */
import type { AnyElement } from "../elements/element-types";
import { shapeOutlineSymmetry } from "../elements/shape-outline-symmetry";
import type { BlockArrowDirection } from "../elements/shape-elements";
import type { ElementUpdate } from "../scene/scene";
import type { ElementTransformResult } from "./group-transform";
import { selectionBoundsOf } from "./selection-geometry";

export type FlipAxis = "horizontal" | "vertical";

const TWO_PI = Math.PI * 2;

function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/** Element types whose appearance is their content, not an outline — never rotated to imitate a mirror. */
const CONTENT_TYPES: ReadonlySet<string> = new Set(["text", "image", "embed"]);

const FLIPPED_DIRECTION: Readonly<Record<BlockArrowDirection, { horizontal: BlockArrowDirection; vertical: BlockArrowDirection }>> = {
  right: { horizontal: "left", vertical: "right" },
  left: { horizontal: "right", vertical: "left" },
  up: { horizontal: "up", vertical: "down" },
  down: { horizontal: "down", vertical: "up" },
};

type StoredPoint = { readonly x: number; readonly y: number } | readonly number[];

/**
 * Reflects every vertex within the point set's *own* extent, leaving the element's bounding box exactly
 * where it was — the selection-level move is applied separately, and doing both here would shift the
 * element twice. Handles both stored shapes: `{x, y}` vertices (line/arrow) and `[x, y, pressure]`
 * tuples (freedraw).
 */
function mirrorPoints(points: readonly StoredPoint[], axis: FlipAxis): StoredPoint[] {
  const index = axis === "horizontal" ? 0 : 1;
  const key = axis === "horizontal" ? "x" : "y";
  const valueOf = (point: StoredPoint) => (Array.isArray(point) ? (point[index] as number) : (point as { x: number; y: number })[key]);

  const values = points.map(valueOf);
  const span = Math.min(...values) + Math.max(...values);

  return points.map((point) => {
    const mirrored = span - valueOf(point);
    if (Array.isArray(point)) {
      const tuple = [...point];
      tuple[index] = mirrored;
      return tuple;
    }
    return { ...(point as { x: number; y: number }), [key]: mirrored };
  });
}

/** The geometry changes specific to `element`'s type, on top of the position/angle mirror every element gets. */
function typeSpecificChanges(element: AnyElement, axis: FlipAxis): ElementUpdate {
  if (element.type === "line" || element.type === "arrow" || element.type === "freedraw") {
    return { points: mirrorPoints(element.points, axis) } as ElementUpdate;
  }
  if (element.type === "block-arrow") {
    return { direction: FLIPPED_DIRECTION[element.direction][axis] } as ElementUpdate;
  }
  if (CONTENT_TYPES.has(element.type)) return {};

  // A bounding-box shape: already symmetric about the flip axis ⇒ nothing to do; symmetric about the
  // other one ⇒ this mirror is a half turn, which `angle` can express; symmetric about neither ⇒ no
  // rotation reproduces the mirror, so the outline is left as it is and only its position moves.
  const symmetry = shapeOutlineSymmetry(element.type);
  const alongFlipAxis = axis === "horizontal" ? symmetry.vertical : symmetry.horizontal;
  const acrossFlipAxis = axis === "horizontal" ? symmetry.horizontal : symmetry.vertical;
  if (alongFlipAxis || !acrossFlipAxis) return {};
  return { angle: normalizeAngle(-element.angle + Math.PI) };
}

/**
 * Mirrors `elements` across the centre line of their shared bounding box. A single element flips in
 * place (its box is the selection's); several swap sides as one, which is the whole point of flipping
 * a group.
 */
export function computeFlipChanges(elements: readonly AnyElement[], axis: FlipAxis): ElementTransformResult[] {
  const live = elements.filter((element) => !element.isDeleted);
  const bounds = selectionBoundsOf(live);
  if (!bounds) return [];

  return live.map((element) => {
    const position =
      axis === "horizontal"
        ? { x: 2 * (bounds.x + bounds.width / 2) - (element.x + element.width) }
        : { y: 2 * (bounds.y + bounds.height / 2) - (element.y + element.height) };

    return {
      id: element.id,
      changes: {
        ...position,
        ...(element.angle === 0 ? {} : { angle: normalizeAngle(-element.angle) }),
        ...typeSpecificChanges(element, axis),
      },
    };
  });
}
