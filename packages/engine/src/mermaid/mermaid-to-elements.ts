/**
 * Mermaid-flowchart → Deviva elements converter (the no-LLM path, like Excalidraw's "Mermaid to
 * Excalidraw"). This file is the thin orchestrator: it parses source into the typed IR
 * (`parse/parse-flowchart.ts`), sizes each node to its label (`map/measure-node-size.ts`), assigns
 * nodes to dependency layers (cycle-aware), maps shapes + styles (`map/`), and emits shapes + labels
 * + arrows anchored at (0,0). A from-scratch dagre layout replaces the simple layered pass in a later
 * phase; the four not-yet-native shapes still approximate. Unrecognized input degrades gracefully.
 *
 * The returned elements are positioned from (0,0); the caller offsets them to the viewport and adds
 * them to the scene. Each node's shape + label share a `groupId` so they move together.
 */
import { createArrowElement } from "../elements/arrow-element";
import type { Arrowhead } from "../elements/arrow-element";
import type { AnyElement } from "./../elements/element-types";
import { createTextElement } from "../elements/text-element";
import { measureNodeSize, type NodeSize } from "./map/measure-node-size";
import { shapeToElement } from "./map/shape-map";
import { resolveEdgeStyle, resolveNodeStyle } from "./map/style-map";
import type { Flowchart, FlowNode, Head } from "./parse/flowchart-ir";
import { parseFlowchart } from "./parse/parse-flowchart";

export type { FlowDirection, Flowchart } from "./parse/flowchart-ir";
export { parseFlowchart } from "./parse/parse-flowchart";

const LAYER_GAP = 80;
const SIBLING_GAP = 40;
const LABEL_LINE_HEIGHT = 24;
/** Edge labels render a touch smaller than node labels, matching Excalidraw. */
const EDGE_LABEL_FONT_SIZE = 16;
const EDGE_LABEL_CHAR_WIDTH = 9;

/** Maps an edge head to the engine's arrowhead style (Phase 05 refines circle/cross rendering). */
function arrowhead(head: Head): Arrowhead {
  return head === "arrow" ? "arrow" : head === "circle" ? "dot" : head === "cross" ? "bar" : "none";
}

/**
 * Indices of edges that close a cycle — a DFS edge pointing back to a node still on the recursion
 * stack (including self-loops). Excluded from layer ranking so a cycle (`B --> D --> B`) can't push
 * layers to infinity; the edges are still drawn (routed toward the target). Dagre's cycle-removal
 * step, done minimally.
 */
function findBackEdges(flow: Flowchart): Set<number> {
  const adjacency = new Map<string, { to: string; index: number }[]>();
  flow.edges.forEach((edge, index) => {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push({ to: edge.to, index });
  });
  const state = new Map<string, 1 | 2>(); // 1 = on the current DFS stack, 2 = fully explored
  const back = new Set<number>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const { to, index } of adjacency.get(id) ?? []) {
      const seen = state.get(to);
      if (seen === 1) back.add(index); // points at an ancestor still on the stack → a cycle-closing edge
      else if (seen === undefined) visit(to);
    }
    state.set(id, 2);
  };
  for (const node of flow.nodes) if (!state.has(node.id)) visit(node.id);
  return back;
}

/** Assigns each node a layer index = longest path from a root, over the acyclic edges only. */
function computeLayers(flow: Flowchart): Map<string, number> {
  const back = findBackEdges(flow);
  const forwardEdges = flow.edges.filter((_, index) => !back.has(index));
  const incoming = new Map<string, number>();
  for (const node of flow.nodes) incoming.set(node.id, 0);
  for (const edge of forwardEdges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);

  const layer = new Map<string, number>();
  const queue = flow.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const id of queue) layer.set(id, 0);
  // Relax edges repeatedly (bounded by node count) so every node lands past all its predecessors.
  // Removing back edges above guarantees this converges instead of ratcheting layers down each pass.
  for (let pass = 0; pass < flow.nodes.length + 1; pass++) {
    for (const edge of forwardEdges) {
      const fromLayer = layer.get(edge.from) ?? 0;
      if ((layer.get(edge.to) ?? 0) < fromLayer + 1) layer.set(edge.to, fromLayer + 1);
    }
  }
  for (const node of flow.nodes) if (!layer.has(node.id)) layer.set(node.id, 0);
  return layer;
}

interface Placed {
  x: number;
  y: number;
  size: NodeSize;
}

/**
 * Size-aware layered placement: each layer is a row (TD/TB/BT) or column (LR/RL) whose cross-extent is
 * its tallest/widest node; siblings pack along the layer with `SIBLING_GAP` and are centered on a shared
 * axis so parents sit above the middle of their children. Full crossing-minimization is Phase 03.
 */
function positionNodes(flow: Flowchart, horizontal: boolean, sizes: Map<string, NodeSize>): Map<string, Placed> {
  const layers = computeLayers(flow);
  const byLayer = new Map<number, FlowNode[]>();
  for (const node of flow.nodes) {
    const l = layers.get(node.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(node);
  }

  const placed = new Map<string, Placed>();
  let crossCursor = 0; // accumulates down/right across layers
  for (const layerIndex of [...byLayer.keys()].sort((a, b) => a - b)) {
    const layerNodes = byLayer.get(layerIndex)!;
    const cross = (s: NodeSize) => (horizontal ? s.width : s.height);
    const along = (s: NodeSize) => (horizontal ? s.height : s.width);
    const rowExtent = Math.max(...layerNodes.map((n) => cross(sizes.get(n.id)!)));
    const totalAlong =
      layerNodes.reduce((sum, n) => sum + along(sizes.get(n.id)!), 0) + SIBLING_GAP * (layerNodes.length - 1);
    let alongCursor = -totalAlong / 2; // center the layer on axis 0
    for (const node of layerNodes) {
      const size = sizes.get(node.id)!;
      const alongPos = alongCursor + along(size) / 2; // center of this node along the layer
      const crossPos = crossCursor + rowExtent / 2; // center within the row's cross-extent
      const center = horizontal ? { x: crossPos, y: alongPos } : { x: alongPos, y: crossPos };
      placed.set(node.id, { x: center.x - size.width / 2, y: center.y - size.height / 2, size });
      alongCursor += along(size) + SIBLING_GAP;
    }
    crossCursor += rowExtent + LAYER_GAP;
  }
  return placed;
}

/** Converts parsed Mermaid into positioned elements (shapes + labels + arrows), anchored at (0,0). */
export function flowchartToElements(flow: Flowchart): AnyElement[] {
  const horizontal = flow.direction === "LR" || flow.direction === "RL";
  const sizes = new Map<string, NodeSize>();
  for (const node of flow.nodes) sizes.set(node.id, measureNodeSize(node.label, node.shape));
  const placed = positionNodes(flow, horizontal, sizes);

  const elements: AnyElement[] = [];
  for (const node of flow.nodes) {
    const p = placed.get(node.id)!;
    const groupIds = [`mermaid-${node.id}`];
    elements.push(
      shapeToElement(node.shape, { x: p.x, y: p.y, width: p.size.width, height: p.size.height, groupIds }, resolveNodeStyle(node, flow)),
    );
    const lines = Math.max(1, node.label.split("\n").length);
    const textHeight = lines * LABEL_LINE_HEIGHT;
    elements.push(
      createTextElement({
        x: p.x + 8,
        y: p.y + (p.size.height - textHeight) / 2,
        width: p.size.width - 16,
        height: textHeight,
        text: node.label,
        textAlign: "center",
        groupIds,
      }),
    );
  }

  for (const edge of flow.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    // Anchor on the side of each box that faces the other node, so a back edge (target above/behind,
    // e.g. `D --> B` in a loop) leaves the source's top and enters the target's bottom instead of
    // routing down-then-all-the-way-up. Along-axis position tracks the two centers.
    const fromCenter = { x: from.x + from.size.width / 2, y: from.y + from.size.height / 2 };
    const toCenter = { x: to.x + to.size.width / 2, y: to.y + to.size.height / 2 };
    let start: { x: number; y: number };
    let end: { x: number; y: number };
    if (horizontal) {
      const rightward = toCenter.x >= fromCenter.x;
      start = { x: rightward ? from.x + from.size.width : from.x, y: fromCenter.y };
      end = { x: rightward ? to.x : to.x + to.size.width, y: toCenter.y };
    } else {
      const downward = toCenter.y >= fromCenter.y;
      start = { x: fromCenter.x, y: downward ? from.y + from.size.height : from.y };
      end = { x: toCenter.x, y: downward ? to.y : to.y + to.size.height };
    }
    const edgeStyle = resolveEdgeStyle(edge, flow);
    const groupIds = [`mermaid-edge-${edge.from}-${edge.to}`];
    elements.push(
      createArrowElement({
        x: start.x,
        y: start.y,
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        points: [
          { x: 0, y: 0 },
          { x: end.x - start.x, y: end.y - start.y },
        ],
        startArrowhead: arrowhead(edge.startHead),
        endArrowhead: arrowhead(edge.endHead),
        strokeColor: edgeStyle.strokeColor,
        strokeWidth: edgeStyle.strokeWidth,
        strokeStyle: edgeStyle.strokeStyle,
        opacity: edgeStyle.opacity,
        groupIds,
      }),
    );
    // Edge label (`A -->|label| B`) — Excalidraw renders these on the arrow. Centered on the arrow's
    // midpoint; grouped with the arrow so they move together.
    if (edge.label) {
      const labelWidth = Math.max(60, edge.label.length * EDGE_LABEL_CHAR_WIDTH);
      elements.push(
        createTextElement({
          x: (start.x + end.x) / 2 - labelWidth / 2,
          y: (start.y + end.y) / 2 - EDGE_LABEL_FONT_SIZE / 2,
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
