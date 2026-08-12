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
 *  - **Images** record the flip on the element itself (`ImageElement.scale`) and are mirrored when
 *    drawn — a photo has no mirrored variant to switch to, and half a turn is not a mirror.
 *
 * Every element's own `angle` is negated regardless: mirroring a rotated element mirrors its rotation.
 * Text is the one thing left upright: a flip that rendered a label as mirror writing is not what
 * anyone means by the word.
 */
import type { AnyElement } from "../elements/element-types";
import { mirrorScaleOf, toggleMirror } from "../elements/element-mirror";
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

/** Types with nothing to mirror: glyphs would become mirror writing, an embed is a live iframe. */
const NEVER_MIRRORED: ReadonlySet<string> = new Set(["text", "embed"]);

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
  if (NEVER_MIRRORED.has(element.type)) return {};

  // Everything else is drawn from its bounding box: record the mirror and let the renderer and the hit
  // test apply it. Toggling means flipping the same way twice returns the element to where it started.
  return { scale: toggleMirror(mirrorScaleOf(element), axis) } as ElementUpdate;
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
