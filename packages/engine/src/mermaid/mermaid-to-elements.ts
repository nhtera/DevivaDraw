/**
 * Mermaid-flowchart → Deviva elements converter (the no-LLM path, like Excalidraw's "Mermaid to
 * Excalidraw"). This file is the thin orchestrator: it parses source into the typed IR
 * (`parse/parse-flowchart.ts`), assigns nodes to dependency layers (cycle-aware), and emits shapes +
 * labels + arrows anchored at (0,0). Full grammar lives in `parse/`; a from-scratch dagre layout and
 * the remaining node shapes/styles arrive in later phases. Unrecognized input degrades gracefully.
 *
 * The returned elements are positioned from (0,0); the caller offsets them to the viewport and adds
 * them to the scene. Each node's shape + label share a `groupId` so they move together.
 */
import { createArrowElement } from "../elements/arrow-element";
import type { Arrowhead } from "../elements/arrow-element";
import type { AnyElement } from "./../elements/element-types";
import {
  createDiamondElement,
  createEllipseElement,
  createHexagonElement,
  createRectangleElement,
} from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import type { Flowchart, FlowNode, Head, NodeShape } from "./parse/flowchart-ir";
import { parseFlowchart } from "./parse/parse-flowchart";

export type { FlowDirection, Flowchart } from "./parse/flowchart-ir";
export { parseFlowchart } from "./parse/parse-flowchart";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 60;
const LAYER_GAP = 80;
const SIBLING_GAP = 40;
/** Edge labels render a touch smaller than node labels, matching Excalidraw. */
const EDGE_LABEL_FONT_SIZE = 16;
const EDGE_LABEL_CHAR_WIDTH = 9;

/** Maps an edge head to the engine's arrowhead style (Phase 05 refines circle/cross rendering). */
function arrowhead(head: Head): Arrowhead {
  return head === "arrow" ? "arrow" : head === "circle" ? "dot" : head === "cross" ? "bar" : "none";
}

/** Interim shape mapping — the four missing shapes approximate until Phase 02 adds them for real. */
function createShapeElement(shape: NodeShape, input: Parameters<typeof createRectangleElement>[0]): AnyElement {
  if (shape === "diamond") return createDiamondElement(input);
  if (shape === "hexagon") return createHexagonElement(input);
  if (shape === "circle" || shape === "double-circle") return createEllipseElement(input);
  const rounded = shape === "rounded" || shape === "stadium";
  return createRectangleElement({ ...input, roundness: rounded ? { type: 1 } : null });
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

/** Positions nodes into centered rows/columns per layer, anchored so parents sit above their children. */
function positionNodes(flow: Flowchart, horizontal: boolean): Map<string, { x: number; y: number }> {
  const layers = computeLayers(flow);
  const byLayer = new Map<number, FlowNode[]>();
  for (const node of flow.nodes) {
    const l = layers.get(node.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(node);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [layerIndex, layerNodes] of byLayer) {
    const step = horizontal ? NODE_HEIGHT + SIBLING_GAP : NODE_WIDTH + SIBLING_GAP;
    // Center each layer on a shared axis (0) so a parent sits above the middle of its children and the
    // arrows fan out symmetrically — Excalidraw's layered look — instead of every layer packing left.
    const alongOffset = ((layerNodes.length - 1) * step) / 2;
    layerNodes.forEach((node, indexInLayer) => {
      const along = indexInLayer * step - alongOffset;
      const across = layerIndex * ((horizontal ? NODE_WIDTH : NODE_HEIGHT) + LAYER_GAP);
      pos.set(node.id, horizontal ? { x: across, y: along } : { x: along, y: across });
    });
  }
  return pos;
}

/** Converts parsed Mermaid into positioned elements (shapes + labels + arrows), anchored at (0,0). */
export function flowchartToElements(flow: Flowchart): AnyElement[] {
  const horizontal = flow.direction === "LR" || flow.direction === "RL";
  const pos = positionNodes(flow, horizontal);

  const elements: AnyElement[] = [];
  for (const node of flow.nodes) {
    const p = pos.get(node.id)!;
    const groupIds = [`mermaid-${node.id}`];
    elements.push(
      createShapeElement(node.shape, { x: p.x, y: p.y, width: NODE_WIDTH, height: NODE_HEIGHT, groupIds, roundness: null }),
    );
    elements.push(
      createTextElement({
        x: p.x + 10,
        y: p.y + NODE_HEIGHT / 2 - 10,
        width: NODE_WIDTH - 20,
        height: 20,
        text: node.label,
        textAlign: "center",
        groupIds,
      }),
    );
  }

  for (const edge of flow.edges) {
    const from = pos.get(edge.from);
    const to = pos.get(edge.to);
    if (!from || !to) continue;
    // Anchor on the side of each box that faces the other node, so a back edge (target above/behind,
    // e.g. `D --> B` in a loop) leaves the source's top and enters the target's bottom instead of
    // routing down-then-all-the-way-up. Along-axis position tracks the two centers.
    const fromCenter = { x: from.x + NODE_WIDTH / 2, y: from.y + NODE_HEIGHT / 2 };
    const toCenter = { x: to.x + NODE_WIDTH / 2, y: to.y + NODE_HEIGHT / 2 };
    let start: { x: number; y: number };
    let end: { x: number; y: number };
    if (horizontal) {
      const rightward = toCenter.x >= fromCenter.x;
      start = { x: rightward ? from.x + NODE_WIDTH : from.x, y: fromCenter.y };
      end = { x: rightward ? to.x : to.x + NODE_WIDTH, y: toCenter.y };
    } else {
      const downward = toCenter.y >= fromCenter.y;
      start = { x: fromCenter.x, y: downward ? from.y + NODE_HEIGHT : from.y };
      end = { x: toCenter.x, y: downward ? to.y : to.y + NODE_HEIGHT };
    }
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
        opacity: edge.kind === "invisible" ? 0 : undefined,
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
