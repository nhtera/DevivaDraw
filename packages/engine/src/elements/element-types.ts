/**
 * The concrete element union and its factory functions.
 *
 * `GenericElement` is a stand-in used by the pre-shape phases; it carries no extra fields beyond
 * `BaseElement` and stays in the union so already-persisted/seeded data of that type still
 * type-checks. Concrete shapes (rectangle, ellipse, diamond, line, freedraw, and later text/arrow/
 * image) are `extends BaseElement` members appended to `AnyElement` — the shape-specific ones live
 * in `shape-elements.ts` (kept separate so this file, and the per-shape factories, stay small) and
 * are re-exported from here so `AnyElement` has one canonical home. `FreedrawElement` lives in its
 * own `freedraw-element.ts` (rather than `shape-elements.ts`) since it isn't a rough.js-rendered
 * bounding-box shape — see that file's doc. `TextElement` similarly lives in its own
 * `text-element.ts` (see that file's doc for the standalone-vs-bound-in-a-container model).
 */
import type { BaseElement } from "./base-element";
import type { ArrowElement } from "./arrow-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";
import type { FrameElement } from "./frame-element";
import type { FreedrawElement } from "./freedraw-element";
import type { ImageElement } from "./image-element";
import type { EmbedElement } from "./embed-element";
import type { NoteElement } from "./note-element";
import type {
  BlockArrowElement,
  CheckBoxElement,
  CloudElement,
  DiamondElement,
  EllipseElement,
  HeartElement,
  HexagonElement,
  LineElement,
  RectangleElement,
  StarElement,
  TriangleElement,
  XBoxElement,
} from "./shape-elements";
import type { TextElement } from "./text-element";

export type { ElementCreationInput } from "./element-factory-defaults";
export type { Arrowhead, ArrowBinding, ArrowElement, ArrowElementCreationInput, ArrowType } from "./arrow-element";
export { createArrowElement, DEFAULT_ARROW_TYPE, DEFAULT_END_ARROWHEAD, DEFAULT_START_ARROWHEAD } from "./arrow-element";
export type { FreedrawElement, FreedrawElementCreationInput, FreedrawPoint } from "./freedraw-element";
export { createFreedrawElement } from "./freedraw-element";
export type { FrameElement, FrameElementCreationInput } from "./frame-element";
export { createFrameElement } from "./frame-element";
export type { NoteElement } from "./note-element";
export { createNoteElement, DEFAULT_NOTE_BACKGROUND } from "./note-element";
export type { ImageElement, ImageElementCreationInput } from "./image-element";
export { createImageElement } from "./image-element";
export type { EmbedElement, EmbedElementCreationInput } from "./embed-element";
export { createEmbedElement, DEFAULT_EMBED_WIDTH, DEFAULT_EMBED_HEIGHT } from "./embed-element";
export type {
  BlockArrowDirection,
  BlockArrowElement,
  BlockArrowElementCreationInput,
  CheckBoxElement,
  CloudElement,
  DiamondElement,
  EllipseElement,
  HeartElement,
  HexagonElement,
  LineElement,
  LineElementCreationInput,
  RectangleElement,
  RelativePoint,
  StarElement,
  TriangleElement,
  XBoxElement,
} from "./shape-elements";
export {
  createBlockArrowElement,
  createCheckBoxElement,
  createCloudElement,
  createDiamondElement,
  createEllipseElement,
  createHeartElement,
  createHexagonElement,
  createLineElement,
  createRectangleElement,
  createStarElement,
  createTriangleElement,
  createXBoxElement,
} from "./shape-elements";
export type { PolygonShapeType } from "./polygon-shape-geometry";
export { isPolygonShapeType, polygonShapeUnitVertices } from "./polygon-shape-geometry";
export type { TextAlign, TextElementCreationInput, TextFontFamily, VerticalAlign } from "./text-element";
export type { TextElement } from "./text-element";
export {
  createTextElement,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_VERTICAL_ALIGN,
} from "./text-element";

/** Stand-in element used before concrete shape types existed; carries no extra fields beyond the base. */
export interface GenericElement extends BaseElement {
  type: "generic";
}

export type AnyElement =
  | GenericElement
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | TriangleElement
  | HexagonElement
  | StarElement
  | BlockArrowElement
  | CloudElement
  | HeartElement
  | XBoxElement
  | CheckBoxElement
  | LineElement
  | FreedrawElement
  | TextElement
  | ArrowElement
  | ImageElement
  | EmbedElement
  | FrameElement
  | NoteElement;

/**
 * Builds a new `GenericElement` with sane defaults for every field the caller did not supply.
 * Kept around (rather than removed) so existing callers/tests/seed data built on the pre-shape-system
 * placeholder element type keep working; new call sites should reach for a concrete shape factory
 * (`createRectangleElement` and friends) instead.
 */
export function createGenericElement(input: ElementCreationInput): GenericElement {
  return { ...createElementBase(input), type: "generic" };
}
