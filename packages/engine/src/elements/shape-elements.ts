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

export interface TriangleElement extends BaseElement {
  type: "triangle";
}

export interface HexagonElement extends BaseElement {
  type: "hexagon";
}

export interface StarElement extends BaseElement {
  type: "star";
}

export interface ParallelogramElement extends BaseElement {
  type: "parallelogram";
}

export interface TrapezoidElement extends BaseElement {
  type: "trapezoid";
}

export interface CylinderElement extends BaseElement {
  type: "cylinder";
}

export interface DoubleCircleElement extends BaseElement {
  type: "double-circle";
}

/** Cardinal direction a block (geo) arrow points. */
export type BlockArrowDirection = "left" | "right" | "up" | "down";

/** A filled directional block arrow (distinct from the `arrow` *connector*) — one element type carrying its `direction` rather than four near-identical types. */
export interface BlockArrowElement extends BaseElement {
  type: "block-arrow";
  direction: BlockArrowDirection;
}

export interface CloudElement extends BaseElement {
  type: "cloud";
}

export interface HeartElement extends BaseElement {
  type: "heart";
}

/** A box with an X through it. */
export interface XBoxElement extends BaseElement {
  type: "x-box";
}

/** A box with a checkmark in it. */
export interface CheckBoxElement extends BaseElement {
  type: "check-box";
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

export function createTriangleElement(input: ElementCreationInput): TriangleElement {
  return { ...createElementBase(input), type: "triangle" };
}

export function createHexagonElement(input: ElementCreationInput): HexagonElement {
  return { ...createElementBase(input), type: "hexagon" };
}

export function createStarElement(input: ElementCreationInput): StarElement {
  return { ...createElementBase(input), type: "star" };
}

export function createParallelogramElement(input: ElementCreationInput): ParallelogramElement {
  return { ...createElementBase(input), type: "parallelogram" };
}

export function createTrapezoidElement(input: ElementCreationInput): TrapezoidElement {
  return { ...createElementBase(input), type: "trapezoid" };
}

export function createCylinderElement(input: ElementCreationInput): CylinderElement {
  return { ...createElementBase(input), type: "cylinder" };
}

export function createDoubleCircleElement(input: ElementCreationInput): DoubleCircleElement {
  return { ...createElementBase(input), type: "double-circle" };
}

export interface BlockArrowElementCreationInput extends ElementCreationInput {
  direction: BlockArrowDirection;
}

export function createBlockArrowElement(input: BlockArrowElementCreationInput): BlockArrowElement {
  return { ...createElementBase(input), type: "block-arrow", direction: input.direction };
}

export function createCloudElement(input: ElementCreationInput): CloudElement {
  return { ...createElementBase(input), type: "cloud" };
}

export function createHeartElement(input: ElementCreationInput): HeartElement {
  return { ...createElementBase(input), type: "heart" };
}

export function createXBoxElement(input: ElementCreationInput): XBoxElement {
  return { ...createElementBase(input), type: "x-box" };
}

export function createCheckBoxElement(input: ElementCreationInput): CheckBoxElement {
  return { ...createElementBase(input), type: "check-box" };
}

export interface LineElementCreationInput extends ElementCreationInput {
  points: readonly RelativePoint[];
}

export function createLineElement(input: LineElementCreationInput): LineElement {
  return { ...createElementBase(input), type: "line", points: input.points };
}
