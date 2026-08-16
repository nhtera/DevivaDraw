/**
 * Diagram creation, both flavors over the engine's OWN flowchart pipeline (in-house parser +
 * dagre-style layout, already shipped for the web dialog) — zero layout code in this package:
 * `create_diagram_from_mermaid` parses mermaid source; `create_diagram` builds the same `Flowchart`
 * AST directly from semantic nodes+edges, so agents that already know their graph skip mermaid
 * syntax (and its escaping pitfalls) entirely.
 */
import { flowchartToElements, tryMermaidToElements } from "@deviva-draw/engine";
import type { AnyElement, Flowchart, MermaidErrorCode, Scene } from "@deviva-draw/engine";
import { z } from "zod";
import { defineTool, summarizeElement, ToolError } from "./tool-types";
import type { ElementSummary, ToolResult } from "./tool-types";

/** Agent-facing explanations for the engine's stable mermaid error codes. */
const MERMAID_ERROR_MESSAGES: Record<MermaidErrorCode, string> = {
  empty: "the mermaid source is empty — pass a flowchart definition like \"flowchart TD\\n  a[Start] --> b[End]\"",
  unsupported: "this mermaid diagram type is not supported here yet — flowchart/graph definitions are; try expressing the diagram as a flowchart",
  invalid: "the mermaid source did not parse into any elements — check the syntax (nodes like `id[Label]`, edges like `a --> b`)",
  error: "unexpected failure while converting the mermaid source — simplify the diagram and try again",
};

const SUMMARY_CAP = 50;

/** Offsets every produced element uniformly and inserts it — ids untouched, so bindings/labels stay valid. */
function insertDiagramElements(scene: Scene, elements: readonly AnyElement[], dx: number, dy: number): { created: number; summaries: ElementSummary[]; truncated?: string } {
  const inserted = elements.map((element) => scene.addElement({ ...element, x: element.x + dx, y: element.y + dy }));
  return {
    created: inserted.length,
    summaries: inserted.slice(0, SUMMARY_CAP).map((element) => summarizeElement(element, scene)),
    ...(inserted.length > SUMMARY_CAP ? { truncated: `showing first ${SUMMARY_CAP} of ${inserted.length}; use list_elements for the rest` } : {}),
  };
}

export const createDiagramFromMermaidTool = defineTool({
  name: "create_diagram_from_mermaid",
  description:
    "Convert mermaid flowchart source (flowchart TD / graph LR, subgraphs, labeled edges, shape brackets) into laid-out, editable elements inserted into the scene at an optional (x, y) offset. Returns element summaries.",
  inputShape: {
    mermaid: z.string().min(1).max(100_000).describe("mermaid flowchart source"),
    x: z.number().finite().optional().describe("scene x offset for the diagram's top-left (default 0)"),
    y: z.number().finite().optional().describe("scene y offset (default 0)"),
  },
  handler: (session, input) => {
    const result = tryMermaidToElements(input.mermaid);
    if (result.error !== undefined) {
      throw new ToolError(`mermaid conversion failed (${result.error}): ${MERMAID_ERROR_MESSAGES[result.error]}`);
    }
    const { created, summaries, truncated } = insertDiagramElements(session.scene, result.elements, input.x ?? 0, input.y ?? 0);
    return { data: { diagramType: result.type, created, elements: summaries, truncated } };
  },
});

/** The engine flowchart node shapes exposed to agents (full parser set minus the alt variants). */
const nodeShapeSchema = z.enum(["rectangle", "rounded", "stadium", "diamond", "circle", "double-circle", "hexagon", "cylinder", "parallelogram", "trapezoid", "subroutine"]);

export const createDiagramTool = defineTool({
  name: "create_diagram",
  description:
    "Create a fully laid-out flowchart from semantic nodes + edges (no mermaid syntax needed): automatic layered layout, shape labels, and arrows bound to their shapes so they re-route when moved. Returns element summaries.",
  inputShape: {
    nodes: z.array(z.object({
      id: z.string().min(1).max(100),
      label: z.string().max(500),
      shape: nodeShapeSchema.optional().describe("default \"rounded\""),
    })).min(1).max(200),
    edges: z.array(z.object({
      from: z.string().min(1).describe("source node id"),
      to: z.string().min(1).describe("target node id"),
      label: z.string().max(200).optional(),
    })).max(500),
    direction: z.enum(["DOWN", "RIGHT"]).optional().describe("layout flow direction (default DOWN)"),
    x: z.number().finite().optional().describe("scene x offset for the diagram's top-left (default 0)"),
    y: z.number().finite().optional().describe("scene y offset (default 0)"),
  },
  handler: (session, input): ToolResult => {
    const ids = new Set<string>();
    for (const node of input.nodes) {
      if (ids.has(node.id)) throw new ToolError(`duplicate node id "${node.id}" — node ids must be unique`);
      ids.add(node.id);
    }
    const unknownRefs = input.edges.flatMap((edge) => [edge.from, edge.to].filter((id) => !ids.has(id)));
    if (unknownRefs.length > 0) {
      throw new ToolError(`edge(s) reference unknown node id(s): ${[...new Set(unknownRefs)].map((id) => `"${id}"`).join(", ")} — every from/to must match a node's id`);
    }
    // Same AST the mermaid parser produces — the in-house dagre layout, label measuring, and arrow
    // binding all come from the one engine path (no new layout code here, per the plan).
    const flowchart: Flowchart = {
      direction: (input.direction ?? "DOWN") === "DOWN" ? "TD" : "LR",
      nodes: input.nodes.map((node) => ({ id: node.id, label: node.label, shape: node.shape ?? "rounded", classes: [] })),
      edges: input.edges.map((edge, index) => ({ from: edge.from, to: edge.to, label: edge.label, kind: "arrow", startHead: "none", endHead: "arrow", minlen: 1, classes: [], index })),
      subgraphs: [],
      styles: [],
      classDefs: new Map(),
      linkStyles: [],
    };
    const { created, summaries, truncated } = insertDiagramElements(session.scene, flowchartToElements(flowchart), input.x ?? 0, input.y ?? 0);
    return { data: { created, elements: summaries, truncated } };
  },
});

export const diagramTools = [createDiagramFromMermaidTool, createDiagramTool];
