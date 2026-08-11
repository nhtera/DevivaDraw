/**
 * Mermaid → Deviva elements converter (the no-LLM path, like Excalidraw's "Mermaid to Excalidraw").
 * `mermaidToElements` detects the diagram type from the first keyword and routes to the matching
 * pipeline: flowchart (here), class, or ER (`class-to-elements.ts` / `er-to-elements.ts`), all sharing
 * the from-scratch dagre layout (`layout/`) and edge emission (`map/edge-elements.ts`). This file owns
 * the flowchart path: parse → size nodes → layout → shapes + bound labels + subgraph frames + arrows.
 *
 * The returned elements are positioned from (0,0); the caller offsets them to the viewport and adds
 * them to the scene. A node's shape + label share a `groupId`; an edge's arrow + label share theirs.
 */
import type { Arrowhead } from "../elements/arrow-element";
import type { AnyElement } from "./../elements/element-types";
import { classToElements } from "./class-to-elements";
import { erToElements } from "./er-to-elements";
import { stateToElements } from "./state-to-elements";
import { layoutFlowchart } from "./layout/layout-flowchart";
import type { LayoutInput } from "./layout/types";
import { createEdgeElements } from "./map/edge-elements";
import { measureNodeSize } from "./map/measure-node-size";
import { createNodeElements } from "./map/node-elements";
import { resolveEdgeStyle, resolveNodeStyle } from "./map/style-map";
import { createSubgraphFrames } from "./map/subgraph-frames";
import { detectDiagramType } from "./parse/detect-diagram";
import type { Flowchart, Head } from "./parse/flowchart-ir";
import { parseFlowchart } from "./parse/parse-flowchart";

export type { FlowDirection, Flowchart } from "./parse/flowchart-ir";
export { parseFlowchart } from "./parse/parse-flowchart";

/** Maps an edge head to the engine's arrowhead style (Phase 05 refines circle/cross rendering). */
function arrowhead(head: Head): Arrowhead {
  return head === "arrow" ? "arrow" : head === "circle" ? "dot" : head === "cross" ? "bar" : "none";
}

/** Converts parsed Mermaid flowchart into positioned elements (shapes + labels + arrows), anchored at (0,0). */
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
    if (!points) continue;
    const edgeStyle = resolveEdgeStyle(edge, flow);
    elements.push(
      ...createEdgeElements(
        points,
        {
          startArrowhead: arrowhead(edge.startHead),
          endArrowhead: arrowhead(edge.endHead),
          strokeColor: edgeStyle.strokeColor,
          strokeWidth: edgeStyle.strokeWidth,
          strokeStyle: edgeStyle.strokeStyle,
          opacity: edgeStyle.opacity,
          label: edge.label,
        },
        `mermaid-edge-${edge.from}-${edge.to}`,
      ),
    );
  }

  return elements;
}

/** One-shot: Mermaid source → positioned elements, routed by diagram type. */
export function mermaidToElements(source: string): AnyElement[] {
  switch (detectDiagramType(source)) {
    case "class":
      return classToElements(source);
    case "er":
      return erToElements(source);
    case "state":
      return stateToElements(source);
    // Sequence gets its native converter in a later phase; until then it returns no elements rather than
    // being mis-parsed as a flowchart. "unsupported" types (pie/gantt/…) are earmarked to be rasterized
    // to an image by the react layer in a later phase, so the engine emits nothing for them.
    case "sequence":
    case "unsupported":
      return [];
    default:
      return flowchartToElements(parseFlowchart(source));
  }
}
