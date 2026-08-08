/**
 * Builds the "selection frame" a resize/rotate gesture operates against: a single selected element
 * resizes/rotates in its *own* local (possibly already-rotated) frame, while a multi-element
 * selection resizes/rotates against the axis-aligned union bbox of all of them (`angle: 0`) — see
 * `resize-handles.ts`'s module doc for why every handle-drag computation downstream of this stays
 * plain axis-aligned math either way (the caller rotates the live pointer point into this frame once
 * per move, not the other way around).
 */
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
