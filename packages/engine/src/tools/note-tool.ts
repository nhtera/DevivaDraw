/**
 * Drag-to-create sticky-note tool. A note is a bindable container (see `text/bound-text.ts`), so its
 * label rides the same double-click-to-edit / centered-layout machinery as a rect/ellipse/diamond;
 * the tool's only job beyond the shared drag gesture (`drag-shape-tool-base.ts`) is to seed the note's
 * distinctive look — a solid fill in the note color with rounded corners — regardless of the current
 * "next shape" style. Stroke color/width still follow the shared style.
 */
import { DEFAULT_NOTE_BACKGROUND } from "../elements/note-element";
import type { NoteElement } from "../elements/note-element";
import { createNoteElement } from "../elements/note-element";
import { ROUND_CORNER_ROUNDNESS_TYPE } from "../render/rough-renderer";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class NoteTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): NoteElement {
    return createNoteElement({
      ...rect,
      ...style,
      backgroundColor: DEFAULT_NOTE_BACKGROUND,
      fillStyle: "solid",
      roundness: { type: ROUND_CORNER_ROUNDNESS_TYPE },
    });
  }
}
