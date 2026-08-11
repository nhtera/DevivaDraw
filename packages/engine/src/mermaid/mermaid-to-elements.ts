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
import { createTextElement } from "../elements/text-element";
import { layoutFlowchart } from "./layout/layout-flowchart";
import type { LayoutInput } from "./layout/types";
import { measureNodeSize } from "./map/measure-node-size";
import { shapeToElement } from "./map/shape-map";
import { resolveEdgeStyle, resolveNodeStyle } from "./map/style-map";
import type { Flowchart, Head } from "./parse/flowchart-ir";
import { parseFlowchart } from "./parse/parse-flowchart";

export type { FlowDirection, Flowchart } from "./parse/flowchart-ir";
export { parseFlowchart } from "./parse/parse-flowchart";

const LABEL_LINE_HEIGHT = 24;
/** Edge labels render a touch smaller than node labels, matching Excalidraw. */
const EDGE_LABEL_FONT_SIZE = 16;
const EDGE_LABEL_CHAR_WIDTH = 9;

/** Maps an edge head to the engine's arrowhead style (Phase 05 refines circle/cross rendering). */
function arrowhead(head: Head): Arrowhead {
  return head === "arrow" ? "arrow" : head === "circle" ? "dot" : head === "cross" ? "bar" : "none";
}

/** Converts parsed Mermaid into positioned elements (shapes + labels + arrows), anchored at (0,0). */
export function flowchartToElements(flow: Flowchart): AnyElement[] {
  const input: LayoutInput = {
    direction: flow.direction,
    nodes: flow.nodes.map((node) => ({ id: node.id, ...measureNodeSize(node.label, node.shape) })),
    edges: flow.edges.map((edge) => ({ from: edge.from, to: edge.to, index: edge.index, minlen: edge.minlen })),
  };
  const layout = layoutFlowchart(input);

  const elements: AnyElement[] = [];
  for (const node of flow.nodes) {
    const box = layout.nodes.get(node.id);
    if (!box) continue;
    const groupIds = [`mermaid-${node.id}`];
    elements.push(shapeToElement(node.shape, { ...box, groupIds }, resolveNodeStyle(node, flow)));
    const lines = Math.max(1, node.label.split("\n").length);
    const textHeight = lines * LABEL_LINE_HEIGHT;
    elements.push(
      createTextElement({
        x: box.x + 8,
        y: box.y + (box.height - textHeight) / 2,
        width: box.width - 16,
        height: textHeight,
        text: node.label,
        textAlign: "center",
        groupIds,
      }),
    );
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
    // Edge label (`A -->|label| B`) — placed at the polyline midpoint, grouped with its arrow.
    if (edge.label) {
      const mid = points[Math.floor(points.length / 2)]!;
      const labelWidth = Math.max(60, edge.label.length * EDGE_LABEL_CHAR_WIDTH);
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
