/**
 * `NoteElement`: a sticky note — a filled, rounded card that holds centered text, the "note" tool both
 * tldraw and FigJam expose. It carries no text of its own: like the other bindable containers
 * (rect/ellipse/diamond, see `text/bound-text.ts`), its label lives as a separate bound text element,
 * so all the existing double-click-to-edit / auto-layout / re-flow machinery works on a note unchanged.
 * Its distinct look (solid fill in a note color, rounded corners) comes from the style the note tool
 * seeds it with, not from extra fields here — hence no fields beyond the base.
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";

export interface NoteElement extends BaseElement {
  type: "note";
}

/** The default sticky-note fill — tldraw's exact note yellow, `rgb(252, 225, 156)`: a warm golden pastel, richer than a washed-out cream but softer than a saturated amber. Applied by the note tool via the element's `backgroundColor`. */
export const DEFAULT_NOTE_BACKGROUND = "#fce19c";

export function createNoteElement(input: ElementCreationInput): NoteElement {
  return { ...createElementBase(input), type: "note" };
}
