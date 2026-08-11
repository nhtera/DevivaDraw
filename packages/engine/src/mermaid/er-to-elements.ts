/**
 * Mermaid `erDiagram` → Deviva elements. Parses to the ER IR, sizes each entity as a compartment box
 * (name / attributes), lays entities out with the shared dagre engine, and emits entity boxes +
 * relationship lines. Relationships are undirected (no arrowheads); the relationship label and the two
 * cardinalities are folded into the edge's midpoint label since the engine has no crow's-foot glyphs.
 * Non-identifying relationships render dashed. Reuses `map/edge-elements.ts`.
 */
import type { AnyElement } from "../elements/element-types";
import { layoutFlowchart } from "./layout/layout-flowchart";
import type { LayoutInput } from "./layout/types";
import { createCompartmentElements, measureCompartment, type CompartmentSpec } from "./map/compartment-node";
import { createEdgeElements } from "./map/edge-elements";
import type { EREntity } from "./parse/er-ir";
import { parseERDiagram } from "./parse/parse-er";

function specOf(entity: EREntity): CompartmentSpec {
  const show = entity.hasBody || entity.attributes.length > 0;
  return { title: entity.name, sections: show ? [entity.attributes] : [] };
}

export function erToElements(source: string): AnyElement[] {
  const diagram = parseERDiagram(source);
  const specs = new Map(diagram.entities.map((entity) => [entity.id, specOf(entity)] as const));
  const input: LayoutInput = {
    direction: "TB",
    nodes: diagram.entities.map((entity) => ({ id: entity.id, ...measureCompartment(specs.get(entity.id)!) })),
    edges: diagram.edges.map((edge) => ({ from: edge.from, to: edge.to, index: edge.index, minlen: 1 })),
  };
  const layout = layoutFlowchart(input);

  const elements: AnyElement[] = [];
  for (const entity of diagram.entities) {
    const box = layout.nodes.get(entity.id);
    if (box) elements.push(...createCompartmentElements(box, specs.get(entity.id)!, `mermaid-${entity.id}`));
  }
  for (const edge of diagram.edges) {
    const points = layout.edges.get(edge.index);
    if (!points) continue;
    const label = [edge.startCard, edge.label, edge.endCard].filter(Boolean).join("  ");
    elements.push(
      ...createEdgeElements(
        points,
        { startArrowhead: "none", endArrowhead: "none", strokeStyle: edge.dashed ? "dashed" : undefined, label: label || undefined },
        `mermaid-edge-${edge.from}-${edge.to}`,
      ),
    );
  }
  return elements;
}
