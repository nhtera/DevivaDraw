/**
 * Concrete drawable shape element types (rectangle, ellipse, diamond, line/polyline) and their
 * factories. Split out from `element-types.ts` to keep that file small; `AnyElement`'s union still
 * lives there and re-exports everything from here as the single public entry point.
 *
 * All style fields (stroke/background color, fill style, stroke width/style, roughness, opacity,
 * roundness, seed) already live on `BaseElement` — nothing shape-specific needs adding for
 * rectangle/ellipse/diamond, which are all just a styled bounding box. `LineElement` is the only one
 * that carries extra geometry (`points`).
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";

export interface RectangleElement extends BaseElement {
  type: "rectangle";
}

export interface EllipseElement extends BaseElement {
  type: "ellipse";
}

export interface DiamondElement extends BaseElement {
  type: "diamond";
}

/** A point relative to the owning element's `(x, y)` origin, in scene units. */
export interface RelativePoint {
  x: number;
  y: number;
}

export interface LineElement extends BaseElement {
  type: "line";
  /**
   * Vertices relative to `(x, y)`, in draw order (at least one). A closed polygon is represented by
   * repeating the first vertex as the last one (see `render/rough-shape-geometry.ts`'s
   * `isClosedPolyline`) rather than a separate boolean flag, so "closed-ness" can never drift out of
   * sync with the actual geometry.
   */
  points: readonly RelativePoint[];
}

export function createRectangleElement(input: ElementCreationInput): RectangleElement {
  return { ...createElementBase(input), type: "rectangle" };
}

export function createEllipseElement(input: ElementCreationInput): EllipseElement {
  return { ...createElementBase(input), type: "ellipse" };
}

export function createDiamondElement(input: ElementCreationInput): DiamondElement {
  return { ...createElementBase(input), type: "diamond" };
}

export interface LineElementCreationInput extends ElementCreationInput {
  points: readonly RelativePoint[];
}

export function createLineElement(input: LineElementCreationInput): LineElement {
  return { ...createElementBase(input), type: "line", points: input.points };
}
