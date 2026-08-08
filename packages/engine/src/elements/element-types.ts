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
 * bounding-box shape — see that file's doc.
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";
import type { FreedrawElement } from "./freedraw-element";
import type { DiamondElement, EllipseElement, LineElement, RectangleElement } from "./shape-elements";

export type { ElementCreationInput } from "./element-factory-defaults";
export type { FreedrawElement, FreedrawElementCreationInput, FreedrawPoint } from "./freedraw-element";
export { createFreedrawElement } from "./freedraw-element";
export type {
  DiamondElement,
  EllipseElement,
  LineElement,
  LineElementCreationInput,
  RectangleElement,
  RelativePoint,
} from "./shape-elements";
export { createDiamondElement, createEllipseElement, createLineElement, createRectangleElement } from "./shape-elements";

/** Stand-in element used before concrete shape types existed; carries no extra fields beyond the base. */
export interface GenericElement extends BaseElement {
  type: "generic";
}

export type AnyElement = GenericElement | RectangleElement | EllipseElement | DiamondElement | LineElement | FreedrawElement;

/**
 * Builds a new `GenericElement` with sane defaults for every field the caller did not supply.
 * Kept around (rather than removed) so existing callers/tests/seed data built on the pre-shape-system
 * placeholder element type keep working; new call sites should reach for a concrete shape factory
 * (`createRectangleElement` and friends) instead.
 */
export function createGenericElement(input: ElementCreationInput): GenericElement {
  return { ...createElementBase(input), type: "generic" };
}
