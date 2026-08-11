/**
 * Mermaid `stateDiagram` / `stateDiagram-v2` → Deviva elements. States are graph nodes and transitions
 * are directed edges, so this reuses the shared dagre engine (`layout/`) and edge emission
 * (`map/edge-elements.ts`), the same way class + ER do. Pseudostates render as distinct glyphs — start
 * = filled dot, end = double circle, choice = diamond, fork/join = a thin bar — and composite states
 * become titled frames (`map/state-frames.ts`) around their clustered members. Transitions touching a
 * composite are retargeted to its entry/exit pseudostate (or first member) so no edge is lost.
 */
import type { AnyElement } from "../elements/element-types";
import { createNodeElements } from "./map/node-elements";
import { shapeToElement } from "./map/shape-map";
import { measureNodeSize } from "./map/measure-node-size";
import { createEdgeElements } from "./map/edge-elements";
import { createStateFrames } from "./map/state-frames";
import { layoutFlowchart } from "./layout/layout-flowchart";
import type { LayoutBox, LayoutInput } from "./layout/types";
import type { FlowDirection, FlowNode, NodeShape } from "./parse/flowchart-ir";
import type { StateDiagram, StateNode } from "./parse/state-ir";
import { parseStateDiagram } from "./parse/parse-state";

const FILLED = { backgroundColor: "#1e1e1e", fillStyle: "solid" as const };
const START_SIZE = 22;
const END_SIZE = 30;
const CHOICE_SIZE = 46;
const BAR_LONG = 60;
const BAR_SHORT = 12;

function measure(node: StateNode, direction: FlowDirection): { width: number; height: number } {
  switch (node.kind) {
    case "start":
      return { width: START_SIZE, height: START_SIZE };
    case "end":
      return { width: END_SIZE, height: END_SIZE };
    case "choice":
      return { width: CHOICE_SIZE, height: CHOICE_SIZE };
    case "fork":
    case "join": {
      const horizontal = direction === "TB" || direction === "TD" || direction === "BT";
      return horizontal ? { width: BAR_LONG, height: BAR_SHORT } : { width: BAR_SHORT, height: BAR_LONG };
    }
    default:
      return measureNodeSize(node.label, "rounded");
  }
}

/** Emits the shape(s) for one state node — a labeled rounded rect for real states, a glyph otherwise. */
function nodeElements(node: StateNode, box: LayoutBox): AnyElement[] {
  const groupIds = [`mermaid-${node.id}`];
  const geo = { ...box, groupIds };
  switch (node.kind) {
    case "state": {
      const flowNode: FlowNode = { id: node.id, label: node.label, shape: "rounded", classes: [] };
      return createNodeElements(flowNode, box, {});
    }
    case "start":
      return [shapeToElement("circle", geo, FILLED)];
    case "end":
      return [shapeToElement("double-circle", geo, {})];
    case "choice":
      return [shapeToElement("diamond", geo, {})];
    case "fork":
    case "join":
      return [shapeToElement("rectangle" as NodeShape, geo, FILLED)];
  }
}

export function stateToElements(source: string): AnyElement[] {
  const diagram: StateDiagram = parseStateDiagram(source);
  const composites = new Set(diagram.composites.map((c) => c.id));
  const nodeIds = new Set(diagram.nodes.map((n) => n.id));
  const firstMember = new Map<string, string>();
  for (const node of diagram.nodes) if (node.parent && !firstMember.has(node.parent)) firstMember.set(node.parent, node.id);

  // A transition touching a composite is redirected to its entry (start) / exit (end) pseudostate, or
  // its first member — so an arrow to/from a nested state still lands somewhere sensible.
  const retarget = (id: string, role: "source" | "target"): string | null => {
    if (!composites.has(id)) return nodeIds.has(id) ? id : null;
    const preferred = role === "source" ? `::end:${id}` : `::start:${id}`;
    if (nodeIds.has(preferred)) return preferred;
    return firstMember.get(id) ?? null;
  };

  const edges: { from: string; to: string; label?: string; index: number }[] = [];
  for (const edge of diagram.edges) {
    const from = retarget(edge.from, "source");
    const to = retarget(edge.to, "target");
    if (!from || !to) continue;
    // Keep genuine self-loops (the layout engine renders them); only drop a self-edge that a composite
    // retarget *collapsed* into one (e.g. a composite's exit landing on its own entry pseudostate).
    const collapsedByRetarget = from === to && edge.from !== edge.to;
    if (!collapsedByRetarget) edges.push({ from, to, label: edge.label, index: edge.index });
  }

  const groups = new Map<string, string>();
  for (const node of diagram.nodes) if (node.parent) groups.set(node.id, node.parent);

  const input: LayoutInput = {
    direction: diagram.direction,
    nodes: diagram.nodes.map((node) => ({ id: node.id, ...measure(node, diagram.direction) })),
    edges: edges.map((edge) => ({ from: edge.from, to: edge.to, index: edge.index, minlen: 1 })),
    groups,
  };
  const layout = layoutFlowchart(input);

  const { frames, frameOfNode } = createStateFrames(diagram.composites, diagram.nodes, layout.nodes);
  const elements: AnyElement[] = [...frames];
  for (const node of diagram.nodes) {
    const box = layout.nodes.get(node.id);
    if (!box) continue;
    const els = nodeElements(node, box);
    const frameId = frameOfNode.get(node.id);
    if (frameId) for (const el of els) el.frameId = frameId;
    elements.push(...els);
  }
  for (const edge of edges) {
    const points = layout.edges.get(edge.index);
    if (points) elements.push(...createEdgeElements(points, { startArrowhead: "none", endArrowhead: "arrow", label: edge.label }, `mermaid-edge-${edge.from}-${edge.to}`));
  }
  return elements;
}
