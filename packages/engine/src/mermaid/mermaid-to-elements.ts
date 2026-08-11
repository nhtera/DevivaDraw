/**
 * Minimal Mermaid-flowchart → Deviva elements converter (Excalidraw's "Mermaid to Excalidraw", the
 * no-LLM one). Parses a useful subset — `graph`/`flowchart` with a direction, node shapes
 * (`id[rect]`, `id(rounded)`, `id{diamond}`), and edges (`A --> B`, `A -->|label| B`, `A --- B`) —
 * lays the nodes out in dependency layers, and emits rectangles/diamonds with centered labels plus
 * connecting arrows. Deliberately small and dependency-free: full Mermaid is huge, but flowcharts
 * cover the overwhelming majority of "paste a diagram" use. Unrecognized lines are skipped.
 *
 * The returned elements are positioned from (0,0); the caller offsets them to the viewport and adds
 * them to the scene. Each node's shape + label share a `groupId` so they move together.
 */
import { createArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "./../elements/element-types";
import { createRectangleElement, createDiamondElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";

export type FlowDirection = "TD" | "TB" | "LR" | "RL" | "BT";

interface ParsedNode {
  id: string;
  label: string;
  shape: "rect" | "rounded" | "diamond";
}
interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
  arrow: boolean;
}
export interface ParsedFlowchart {
  direction: FlowDirection;
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 60;
const LAYER_GAP = 80;
const SIBLING_GAP = 40;
/** Edge labels render a touch smaller than node labels, matching Excalidraw. */
const EDGE_LABEL_FONT_SIZE = 16;
const EDGE_LABEL_CHAR_WIDTH = 9;

/** Parses one `id[label]` / `id(label)` / `id{label}` / bare-`id` token into a node descriptor. */
function parseNodeToken(raw: string, nodes: Map<string, ParsedNode>): string | null {
  const token = raw.trim();
  const match = token.match(/^([A-Za-z0-9_]+)\s*(?:\[(.+)\]|\((.+)\)|\{(.+)\})?$/);
  if (!match) return null;
  const [, id, rect, rounded, diamond] = match;
  if (!id) return null;
  const existing = nodes.get(id);
  const label = rect ?? rounded ?? diamond;
  const shape = diamond !== undefined ? "diamond" : rounded !== undefined ? "rounded" : "rect";
  if (label !== undefined || !existing) {
    nodes.set(id, { id, label: label ?? existing?.label ?? id, shape: label !== undefined ? shape : existing?.shape ?? "rect" });
  }
  return id;
}

export function parseFlowchart(source: string): ParsedFlowchart {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let direction: FlowDirection = "TD";
  const nodes = new Map<string, ParsedNode>();
  const edges: ParsedEdge[] = [];

  for (const line of lines) {
    const header = line.match(/^(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)/i);
    if (header) {
      direction = header[1]!.toUpperCase() as FlowDirection;
      continue;
    }
    if (/^(?:graph|flowchart)\b/i.test(line)) continue;

    const edge = line.match(/^(.+?)\s*(-->|---)\s*(?:\|(.+?)\|\s*)?(.+)$/);
    if (edge) {
      const from = parseNodeToken(edge[1]!, nodes);
      const to = parseNodeToken(edge[4]!, nodes);
      if (from && to) edges.push({ from, to, label: edge[3]?.trim(), arrow: edge[2] === "-->" });
      continue;
    }
    parseNodeToken(line, nodes); // a standalone node declaration
  }

  return { direction, nodes: [...nodes.values()], edges };
}

/**
 * Indices of edges that close a cycle — a DFS edge pointing back to a node still on the recursion
 * stack (including self-loops). Excluded from layer ranking so a cycle (`B --> D --> B`) can't push
 * layers to infinity; the edges are still drawn (routed upward). This is dagre's cycle-removal step,
 * done minimally.
 */
function findBackEdges(flow: ParsedFlowchart): Set<number> {
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
function computeLayers(flow: ParsedFlowchart): Map<string, number> {
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

/** Converts parsed Mermaid into positioned elements (shapes + labels + arrows), anchored at (0,0). */
export function flowchartToElements(flow: ParsedFlowchart): AnyElement[] {
  const layers = computeLayers(flow);
  const byLayer = new Map<number, ParsedNode[]>();
  for (const node of flow.nodes) {
    const l = layers.get(node.id) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(node);
  }

  const horizontal = flow.direction === "LR" || flow.direction === "RL";
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

  const elements: AnyElement[] = [];
  for (const node of flow.nodes) {
    const p = pos.get(node.id)!;
    const groupIds = [`mermaid-${node.id}`];
    const shapeInput = { x: p.x, y: p.y, width: NODE_WIDTH, height: NODE_HEIGHT, groupIds, roundness: node.shape === "rounded" ? { type: 1 } : null };
    elements.push(node.shape === "diamond" ? createDiamondElement(shapeInput) : createRectangleElement(shapeInput));
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
        endArrowhead: edge.arrow ? "arrow" : "none",
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
