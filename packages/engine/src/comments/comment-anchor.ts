/**
 * Read-time resolution of a comment pin's scene position.
 *
 * An `element` anchor stores its position as a fraction of the shape's UNROTATED local box, so the
 * pin rides move, resize, and rotate with zero writes — a moved shape does not dirty its threads,
 * which is what keeps a drag from flooding the wire with comment deltas. When the shape is gone
 * (deleted, or simply not arrived on this peer yet), resolution falls back to the absolute point
 * recorded at creation time. That fallback NEVER rewrites the stored anchor: a peer that still has
 * the shape must keep resolving against it, and a rewrite race between the two peers is exactly the
 * kind of divergence the read-time rule in `scene-layers.ts` exists to avoid.
 */
import type { AnyElement } from "../elements/element-types";
import { elementCenter, rotatePointAroundCenter } from "../elements/element-geometry";
import type { Point } from "../render/camera";
import type { CommentAnchor } from "./comment-types";

/** The element lookup `resolveCommentAnchor` needs — `Scene` satisfies it structurally, and a test can pass a one-line stub. */
export interface CommentAnchorElementSource {
  getElement(id: string): AnyElement | undefined;
}

/** Degenerate boxes (a zero-width line, a freshly-started shape) have no meaningful fraction; the pin sits at the box's own origin edge rather than dividing by zero. */
function fractionOf(offset: number, size: number): number {
  return size === 0 ? 0 : offset / size;
}

/**
 * Builds an `element` anchor for `scenePoint` on `element`. The scene point is un-rotated back into
 * the element's local box first, so the stored fraction is rotation-independent and re-rotating it
 * at read time reproduces the exact point the user clicked.
 */
export function anchorForElementPoint(element: Pick<AnyElement, "id" | "x" | "y" | "width" | "height" | "angle">, scenePoint: Point): CommentAnchor {
  const center = elementCenter(element);
  const local = rotatePointAroundCenter(scenePoint, center, -element.angle);
  return {
    kind: "element",
    elementId: element.id,
    fx: fractionOf(local.x - element.x, element.width),
    fy: fractionOf(local.y - element.y, element.height),
    x: scenePoint.x,
    y: scenePoint.y,
  };
}

/**
 * Where the pin should be drawn right now, or `null` for a `page` anchor (a thread about the board
 * as a whole has no canvas pin — it lives only in the panel).
 *
 * A soft-deleted anchor element counts as absent: the thread degrades to a point pin at its last
 * known position, which is what makes a thread survive the deletion of the shape it discussed.
 */
export function resolveCommentAnchor(anchor: CommentAnchor, source: CommentAnchorElementSource): Point | null {
  if (anchor.kind === "page") return null;
  if (anchor.kind === "point") return { x: anchor.x, y: anchor.y };

  const element = source.getElement(anchor.elementId);
  if (!element || element.isDeleted) return { x: anchor.x, y: anchor.y };

  const local: Point = { x: element.x + anchor.fx * element.width, y: element.y + anchor.fy * element.height };
  return rotatePointAroundCenter(local, elementCenter(element), element.angle);
}

/** True when the anchor points at a shape that is no longer resolvable — the signal the UI uses to mark a pin as orphaned rather than silently drawing it somewhere stale. */
export function isOrphanedAnchor(anchor: CommentAnchor, source: CommentAnchorElementSource): boolean {
  if (anchor.kind !== "element") return false;
  const element = source.getElement(anchor.elementId);
  return !element || element.isDeleted;
}
