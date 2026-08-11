/**
 * Mermaid-flowchart → Deviva elements converter (the no-LLM path, like Excalidraw's "Mermaid to
 * Excalidraw"). This file is the thin orchestrator: parse source into the typed IR
 * (`parse/parse-flowchart.ts`), size each node to its label (`map/measure-node-size.ts`), run the
 * from-scratch layered/dagre layout (`layout/`), map shapes + styles (`map/`), and emit shapes +
 * labels + arrows. The four not-yet-native shapes still approximate (Phase 02b). Unrecognized input
 * degrades gracefully.
 *
 * The returned elements are positioned from (0,0); the caller offsets them to the viewport and adds
 * them to the scene. Each node's shape + label share a `groupId` so they move together, and an edge's
 * arrow + label share theirs.
 */
import { createArrowElement } from "../elements/arrow-element";
import type { Arrowhead } from "../elements/arrow-element";
import type { AnyElement } from "./../elements/element-types";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { layoutFlowchart } from "./layout/layout-flowchart";
import type { LayoutInput } from "./layout/types";
import { measureNodeSize } from "./map/measure-node-size";
import { createNodeElements } from "./map/node-elements";
import { resolveEdgeStyle, resolveNodeStyle } from "./map/style-map";
import { createSubgraphFrames } from "./map/subgraph-frames";
import type { Flowchart, Head } from "./parse/flowchart-ir";
import { parseFlowchart } from "./parse/parse-flowchart";

export type { FlowDirection, Flowchart } from "./parse/flowchart-ir";
export { parseFlowchart } from "./parse/parse-flowchart";

/** Edge labels render a touch smaller than node labels, matching Excalidraw. */
const EDGE_LABEL_FONT_SIZE = 16;
const EDGE_LABEL_CHAR_WIDTH = 9;

/** Maps an edge head to the engine's arrowhead style (Phase 05 refines circle/cross rendering). */
function arrowhead(head: Head): Arrowhead {
  return head === "arrow" ? "arrow" : head === "circle" ? "dot" : head === "cross" ? "bar" : "none";
}

/** The point halfway along a polyline by arc length — where an edge label should sit, clear of both boxes. */
function polylineMidpoint(points: { x: number; y: number }[]): { x: number; y: number } {
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

/** Converts parsed Mermaid into positioned elements (shapes + labels + arrows), anchored at (0,0). */
export function flowchartToElements(flow: Flowchart): AnyElement[] {
  const groups = new Map<string, string>();
  for (const node of flow.nodes) if (node.subgraphId !== undefined) groups.set(node.id, node.subgraphId);
  const input: LayoutInput = {
    direction: flow.direction,
    nodes: flow.nodes.map((node) => ({ id: node.id, ...measureNodeSize(node.label, node.shape) })),
    edges: flow.edges.map((edge) => ({ from: edge.from, to: edge.to, index: edge.index, minlen: edge.minlen })),
    groups,
  };
  const layout = layoutFlowchart(input);

  // Subgraphs → frames, emitted first so they sit behind the nodes; members get `frameId`.
  const { frames, frameOfNode } = createSubgraphFrames(flow, layout.nodes);
  const elements: AnyElement[] = [...frames];
  for (const node of flow.nodes) {
    const box = layout.nodes.get(node.id);
    if (!box) continue;
    const nodeElements = createNodeElements(node, box, resolveNodeStyle(node, flow));
    const frameId = frameOfNode.get(node.id);
    if (frameId) for (const element of nodeElements) element.frameId = frameId;
    elements.push(...nodeElements);
  }

  for (const edge of flow.edges) {
    const points = layout.edges.get(edge.index);
    if (!points || points.length < 2) continue;
    const origin = points[0]!;
    const relative = points.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
    const xs = relative.map((p) => p.x);
    const ys = relative.map((p) => p.y);
    const edgeStyle = resolveEdgeStyle(edge, flow);
    const groupIds = [`mermaid-edge-${edge.from}-${edge.to}`];
    elements.push(
      createArrowElement({
        x: origin.x,
        y: origin.y,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        points: relative,
        startArrowhead: arrowhead(edge.startHead),
        endArrowhead: arrowhead(edge.endHead),
        strokeColor: edgeStyle.strokeColor,
        strokeWidth: edgeStyle.strokeWidth,
        strokeStyle: edgeStyle.strokeStyle,
        opacity: edgeStyle.opacity,
        groupIds,
      }),
    );
    // Edge label (`A -->|label| B`) — placed at the polyline's arc-length midpoint (clear of both
    // boxes), sitting on a solid pill so the arrow visually breaks around it, like Excalidraw. Pushed
    // pill-then-text after the arrow so z-order is arrow < pill < text.
    if (edge.label) {
      const mid = polylineMidpoint(points);
      const labelWidth = Math.max(48, edge.label.length * EDGE_LABEL_CHAR_WIDTH);
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
          text: edge.label,
          fontSize: EDGE_LABEL_FONT_SIZE,
          textAlign: "center",
          groupIds,
        }),
      );
    }
  }

  return elements;
}

/** One-shot: Mermaid source → positioned elements. */
export function mermaidToElements(source: string): AnyElement[] {
  return flowchartToElements(parseFlowchart(source));
}
