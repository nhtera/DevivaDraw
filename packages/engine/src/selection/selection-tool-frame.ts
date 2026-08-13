/**
 * Builds the "selection frame" a resize/rotate gesture operates against: a single selected element
 * resizes/rotates in its *own* local (possibly already-rotated) frame, while a multi-element
 * selection resizes/rotates against the axis-aligned union bbox of all of them (`angle: 0`) — see
 * `resize-handles.ts`'s module doc for why every handle-drag computation downstream of this stays
 * plain axis-aligned math either way (the caller rotates the live pointer point into this frame once
 * per move, not the other way around).
 */
import type { ArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "../elements/element-types";
import type { ElementTransformInput } from "./group-transform";
import { selectionBoundsOf } from "./group-transform";
import { elementCenter } from "./selection-geometry";
import type { Point } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";

export interface SelectionFrame {
  bounds: SceneRect;
  angle: number;
  pivot: Point;
  members: ElementTransformInput[];
}

function toTransformInput(element: AnyElement): ElementTransformInput {
  return { id: element.id, x: element.x, y: element.y, width: element.width, height: element.height, angle: element.angle };
}

/** `null` for an empty selection — nothing to build a frame from. */
export function buildSelectionFrame(elements: readonly AnyElement[]): SelectionFrame | null {
  const live = elements.filter((element) => !element.isDeleted);
  if (live.length === 0) return null;

  if (live.length === 1) {
    const element = live[0]!;
    return {
      bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
      angle: element.angle,
      pivot: elementCenter(element),
      members: [toTransformInput(element)],
    };
  }

  const bounds = selectionBoundsOf(live)!;
  return { bounds, angle: 0, pivot: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, members: live.map(toTransformInput) };
}

/**
 * What the overlay should draw for the current selection. A lone arrow is a polyline, not a box, so
 * it gets vertex handles (`selection/linear-handles.ts`) instead of a bounding box with eight resize
 * squares — dragging an arrow's corner to "resize" it was never a meaningful edit, whereas dragging
 * its endpoint is the whole point of an arrow.
 *
 * Everything else — several elements, or anything that is not an arrow — keeps the bbox frame
 * untouched, including an arrow selected *alongside* other elements, where the group really does
 * resize as a unit.
 */
export type SelectionOverlay = { kind: "bbox"; frame: SelectionFrame } | { kind: "linear"; arrow: ArrowElement };

/** `null` for an empty selection — see `buildSelectionFrame`, which this wraps. */
export function buildSelectionOverlay(elements: readonly AnyElement[]): SelectionOverlay | null {
  const live = elements.filter((element) => !element.isDeleted);
  const only = live.length === 1 ? live[0]! : null;
  // A locked arrow keeps the plain frame: its handles would advertise an edit that cannot happen.
  if (only?.type === "arrow" && !only.locked) return { kind: "linear", arrow: only };

  const frame = buildSelectionFrame(elements);
  return frame ? { kind: "bbox", frame } : null;
}
