/**
 * Fields shared by every drawable element on the canvas.
 *
 * `version`, `versionNonce`, and `index` exist from this first commit even though nothing
 * consumes them yet: retrofitting collaborative merge (last-writer-wins on `version`, tie-break
 * on `versionNonce`) or stable z-ordering (`index`) onto an already-shipped schema would force a
 * breaking migration of every persisted document. Every field here must stay JSON-serializable
 * (no class instances, no functions) so a scene can be persisted and sent over the wire as-is.
 */

/** How the interior of a closed shape is rendered. */
export type FillStyle = "hachure" | "cross-hatch" | "solid" | "zigzag";

/** How the outline of a shape is stroked. */
export type StrokeStyle = "solid" | "dashed" | "dotted";

/** Corner rounding. `type` selects the rounding algorithm; concrete values land with the shape phases. */
export interface RoundnessValue {
  type: number;
}

/** A reference from one element to another it is visually bound to (e.g. a label bound to a shape). */
export interface BoundElementRef {
  id: string;
  type: string;
}

export interface BaseElement {
  readonly id: string;
  /** Discriminant for the concrete element union; `"generic"` is the initial member of the union. */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in radians. */
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  /** Hand-drawn "sketchiness" passed to the rough renderer; 0 = perfectly clean lines. */
  roughness: number;
  /** 0-100. */
  opacity: number;
  roundness: RoundnessValue | null;
  /**
   * Mirroring as `[x, y]` multipliers of ±1, absent when the element has never been flipped — see
   * `element-mirror.ts`, and read it through that module's `mirrorScaleOf` rather than directly.
   * Honoured by everything drawn from its bounding box; point geometry (line/arrow/freedraw) mirrors
   * its own points instead, and text is never mirrored.
   */
  scale?: readonly [x: number, y: number];
  /** Deterministic seed for the sketchy renderer, so re-renders of an unchanged element look identical. */
  seed: number;
  /** Outermost-to-innermost group ids this element belongs to; empty when ungrouped. */
  groupIds: string[];
  frameId: string | null;
  boundElements: BoundElementRef[] | null;
  link: string | null;
  locked: boolean;
  /** Fractional sort key controlling draw order; see `scene/fractional-index.ts`. */
  index: string;
  /**
   * Layer membership — absent means the scene's DEFAULT layer (see `scene/scene-layers.ts`'s
   * convention doc): only non-default membership is ever stamped, so pre-layers documents and
   * untouched scenes stay byte-identical on the wire. An id no current layer knows resolves to the
   * default layer at read time without this field being rewritten.
   */
  layerId?: string;
  /** Monotonically increasing per-element edit counter; bumped on every mutation. */
  version: number;
  /** Random tie-breaker regenerated on every mutation, used to order concurrent edits of equal `version`. */
  versionNonce: number;
  /** Unix ms timestamp of the last mutation. */
  updated: number;
  /**
   * Soft-delete tombstone. Deleted elements stay in the scene (never hard-removed) so that:
   * (1) undo can restore a delete without reconstructing the element from scratch, and
   * (2) a later merge with a remote peer's edit to the same element does not resurrect stale data.
   * Consumers that render or export the scene must filter `isDeleted` elements out themselves —
   * the store does not purge them.
   */
  isDeleted: boolean;
}
