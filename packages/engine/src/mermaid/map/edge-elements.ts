/**
 * Shared edge → elements emission for every Mermaid diagram type (flowchart, class, ER). Turns a
 * routed polyline (scene coords) into an arrow element with the given arrowheads/stroke, plus, when
 * the edge is labelled, a solid pill at the polyline's arc-length midpoint so the line reads as
 * broken around the label — the Excalidraw look. Arrow + pill + label share one group id.
 */
import type { Arrowhead } from "../../elements/arrow-element";
import { createArrowElement } from "../../elements/arrow-element";
import type { AnyElement } from "../../elements/element-types";
import { createRectangleElement } from "../../elements/shape-elements";
import { createTextElement } from "../../elements/text-element";

const EDGE_LABEL_FONT_SIZE = 16;
const EDGE_LABEL_CHAR_WIDTH = 9;

export interface EdgeVisual {
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  opacity?: number;
  label?: string;
}

interface Point {
  x: number;
  y: number;
}

/** The point halfway along a polyline by arc length — where an edge label should sit, clear of both boxes. */
function polylineMidpoint(points: Point[]): Point {
  const segments = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let remaining = segments.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < segments.length; i++) {
    if (remaining <= segments[i]!) {
      const t = segments[i] === 0 ? 0 : remaining / segments[i]!;
      return { x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * t, y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * t };
    }
    remaining -= segments[i]!;
  }
  return points[Math.floor(points.length / 2)]!;
}

export function createEdgeElements(points: Point[], visual: EdgeVisual, groupId: string): AnyElement[] {
  if (points.length < 2) return [];
  const origin = points[0]!;
  const relative = points.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
  const xs = relative.map((p) => p.x);
  const ys = relative.map((p) => p.y);
  const groupIds = [groupId];
  const elements: AnyElement[] = [
    createArrowElement({
      x: origin.x,
      y: origin.y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      points: relative,
      startArrowhead: visual.startArrowhead,
      endArrowhead: visual.endArrowhead,
      strokeColor: visual.strokeColor,
      strokeWidth: visual.strokeWidth,
      strokeStyle: visual.strokeStyle,
      opacity: visual.opacity,
      groupIds,
    }),
  ];
  if (visual.label) {
    const mid = polylineMidpoint(points);
    const labelWidth = Math.max(48, visual.label.length * EDGE_LABEL_CHAR_WIDTH);
    const labelHeight = EDGE_LABEL_FONT_SIZE + 8;
    elements.push(
      createRectangleElement({
        x: mid.x - labelWidth / 2,
        y: mid.y - labelHeight / 2,
        width: labelWidth,
        height: labelHeight,
        backgroundColor: "#ffffff",
        fillStyle: "solid",
        strokeColor: "transparent",
        roundness: { type: 1 },
        groupIds,
      }),
    );
    elements.push(
      createTextElement({
        x: mid.x - labelWidth / 2,
        y: mid.y - EDGE_LABEL_FONT_SIZE / 2,
        width: labelWidth,
        height: EDGE_LABEL_FONT_SIZE + 4,
        text: visual.label,
        fontSize: EDGE_LABEL_FONT_SIZE,
        textAlign: "center",
        groupIds,
      }),
    );
  }
  return elements;
}
