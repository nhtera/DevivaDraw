/**
 * Maps an IR node shape + resolved style to a concrete Deviva element. Diamond, hexagon, and
 * circle/ellipse map exactly; the four shapes the engine doesn't have yet (cylinder, double-circle,
 * parallelogram, trapezoid) approximate to their nearest neighbour until Phase 02b adds them for real
 * — the approximation is isolated here so swapping in the real factories is a one-file change.
 */
import type { AnyElement } from "../../elements/element-types";
import {
  createCylinderElement,
  createDiamondElement,
  createDoubleCircleElement,
  createEllipseElement,
  createHexagonElement,
  createParallelogramElement,
  createRectangleElement,
  createTrapezoidElement,
} from "../../elements/shape-elements";
import type { NodeShape } from "../parse/flowchart-ir";
import type { ResolvedNodeStyle } from "./style-map";

export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  groupIds: string[];
}

/** Shapes rendered with a pill/rounded rectangle outline. */
const ROUNDED: ReadonlySet<NodeShape> = new Set(["rounded", "stadium"]);
const PARALLELOGRAM: ReadonlySet<NodeShape> = new Set(["parallelogram", "parallelogram-alt"]);
const TRAPEZOID: ReadonlySet<NodeShape> = new Set(["trapezoid", "trapezoid-alt"]);

export function shapeToElement(shape: NodeShape, geo: NodeGeometry, style: ResolvedNodeStyle): AnyElement {
  const input = {
    ...geo,
    roundness: ROUNDED.has(shape) ? ({ type: 1 } as const) : null,
    strokeColor: style.strokeColor,
    backgroundColor: style.backgroundColor,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    fillStyle: style.fillStyle,
  };
  if (shape === "diamond") return createDiamondElement(input);
  if (shape === "hexagon") return createHexagonElement(input);
  if (shape === "circle") return createEllipseElement(input);
  if (shape === "double-circle") return createDoubleCircleElement(input);
  if (shape === "cylinder") return createCylinderElement(input);
  // The `-alt` variants mirror their base; a single lean is a faithful-enough v1 for both.
  if (PARALLELOGRAM.has(shape)) return createParallelogramElement(input);
  if (TRAPEZOID.has(shape)) return createTrapezoidElement(input);
  return createRectangleElement(input);
}
