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

/** Assigns each node a layer index = longest path from a root (a node with no incoming edge). */
function computeLayers(flow: ParsedFlowchart): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const node of flow.nodes) incoming.set(node.id, 0);
  for (const edge of flow.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);

  const layer = new Map<string, number>();
  const queue = flow.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const id of queue) layer.set(id, 0);
  // Relax edges repeatedly (bounded by node count) so every node lands past all its predecessors.
  for (let pass = 0; pass < flow.nodes.length + 1; pass++) {
    for (const edge of flow.edges) {
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
    const start = { x: from.x + NODE_WIDTH / 2, y: from.y + NODE_HEIGHT };
    const end = { x: to.x + NODE_WIDTH / 2, y: to.y };
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
