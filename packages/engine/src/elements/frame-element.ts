/**
 * `FrameElement`: a named rectangular region that groups the elements inside it (see
 * `selection/frame-membership.ts`) — dragging the frame moves its contents with it, the organizing
 * primitive every board editor exposes. Rendered as a thin border plus a name label above the
 * top edge (`render/frame-renderer.ts`); its interior is deliberately transparent (and not a
 * pointer-hit target) so the elements it holds stay visible and clickable — you grab a frame by its
 * border or header, not by clicking through its middle.
 *
 * Style fields inherited from `BaseElement` (fill/roughness/roundness/etc.) are unused: a frame's
 * appearance is fixed chrome, not user-styled — kept on the type only because every element shares one
 * `BaseElement` shape.
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";

/**
 * Cap on `notes`. Presenter notes are prose for one slide, not a document — the cap exists because
 * this string rides every element delta on the collab wire and every autosave write, so an unbounded
 * field here is a size problem on channels that are otherwise bounded.
 */
export const MAX_FRAME_NOTES_LENGTH = 4000;

export interface FrameElement extends BaseElement {
  type: "frame";
  /** The frame's display name, shown in its header label (e.g. `"Frame 1"`). */
  name: string;
  /**
   * Presenter notes for this frame when the deck is presented — shown only in the presenter's HUD,
   * never drawn on canvas.
   *
   * Deliberately a field on the element rather than a side store: editing it is an ordinary
   * `updateElement` call, so it bumps `version`, enters undo history, and syncs over collab with no
   * new wiring at all. Optional and omitted when unset, so a frame that has never carried notes
   * serializes exactly as it did before this field existed, and an older build that drops it on
   * resave loses notes but nothing else.
   *
   * What riding that path also inherits: the collab wire validator (`lww-merge.ts`'s
   * `isPlausibleRemoteElement`) checks only the envelope, not per-type fields, so a hand-crafted
   * element delta can carry a `notes` string past `MAX_FRAME_NOTES_LENGTH`. That gap is shared with
   * every other type-specific field (table cells, this frame's own `name`) and is bounded by the
   * relay's message-size cap and rate limiter rather than by this constant. Closing it belongs with
   * a per-type wire validator, not here.
   */
  notes?: string;
}

export interface FrameElementCreationInput extends ElementCreationInput {
  /** Defaults to `"Frame"` when omitted — callers that number frames pass e.g. `"Frame 3"`. */
  name?: string;
  /** Presenter notes. Omitted (not `""`) when absent, so an un-annotated frame carries no extra field. */
  notes?: string;
}

export function createFrameElement(input: FrameElementCreationInput): FrameElement {
  const notes = input.notes?.slice(0, MAX_FRAME_NOTES_LENGTH);
  return { ...createElementBase(input), type: "frame", name: input.name ?? "Frame", ...(notes ? { notes } : {}) };
}
