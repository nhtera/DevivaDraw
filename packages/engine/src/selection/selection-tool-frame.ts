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
 * What the overlay should draw for the current selection, split the way Excalidraw splits it.
 *
 * A lone *two-point* arrow is a line, not a box: it gets vertex handles
 * (`selection/linear-handles.ts`) and no frame at all. Dragging such an arrow's corner to "resize" it
 * was never a meaningful edit, whereas dragging its endpoint is the whole point of an arrow, and a
 * box drawn around a single diagonal segment is mostly empty canvas.
 *
 * A lone arrow with a bend has both: the bbox frame *and* its vertex handles on top. Once an arrow
 * has interior points, scaling the whole shape of it is a real edit again — and it is the only way to
 * rotate one.
 *
 * Everything else keeps the bbox frame untouched: several elements (where the group resizes as a
 * unit), anything that is not an arrow, and a locked arrow — whose handles would advertise an edit
 * that cannot happen. `arrow` is the lone arrow whose handles the overlay should also draw, or
 * `null`.
 */
export type SelectionOverlay =
  | { kind: "bbox"; frame: SelectionFrame; arrow: ArrowElement | null }
  | { kind: "linear"; arrow: ArrowElement };

/** A two-point arrow has no interior geometry to scale, so it is the one that drops the frame. */
const MAX_POINTS_WITHOUT_FRAME = 2;

/** `null` for an empty selection — see `buildSelectionFrame`, which this wraps. */
export function buildSelectionOverlay(elements: readonly AnyElement[]): SelectionOverlay | null {
  const live = elements.filter((element) => !element.isDeleted);
  const only = live.length === 1 ? live[0]! : null;
  const arrow = only?.type === "arrow" && !only.locked ? only : null;
  if (arrow && arrow.points.length <= MAX_POINTS_WITHOUT_FRAME) return { kind: "linear", arrow };

  const frame = buildSelectionFrame(elements);
  return frame ? { kind: "bbox", frame, arrow } : null;
}
