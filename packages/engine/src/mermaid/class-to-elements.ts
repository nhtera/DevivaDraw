/**
 * Mermaid `classDiagram` → Deviva elements. Parses to the class IR, sizes each class as a compartment
 * box (name / attributes / methods), lays classes out with the shared dagre engine (top-down), and
 * emits compartment boxes + relation edges. Relation type drives the arrowheads: inheritance/
 * realization get a triangle at the parent end; association/dependency/composition/aggregation get an
 * arrow at the target; realization/dependency render dashed. Reuses `map/edge-elements.ts`.
 */
import type { AnyElement } from "../elements/element-types";
import { layoutFlowchart } from "./layout/layout-flowchart";
import type { LayoutInput } from "./layout/types";
import { createCompartmentElements, measureCompartment, type CompartmentSpec } from "./map/compartment-node";
import { createEdgeElements, type EdgeVisual } from "./map/edge-elements";
import type { ClassNode, ClassRelation } from "./parse/class-ir";
import { parseClassDiagram } from "./parse/parse-class";

function specOf(node: ClassNode): CompartmentSpec {
  const showCompartments = node.hasBody || node.attributes.length > 0 || node.methods.length > 0;
  return { title: node.name, sections: showCompartments ? [node.attributes, node.methods] : [] };
}

function edgeVisual(relation: ClassRelation, dashed: boolean, label: string | undefined): EdgeVisual {
  const strokeStyle = dashed ? "dashed" : undefined;
  if (relation === "inheritance" || relation === "realization") {
    return { startArrowhead: "triangle", endArrowhead: "none", strokeStyle, label };
  }
  if (relation === "link") return { startArrowhead: "none", endArrowhead: "none", strokeStyle, label };
  return { startArrowhead: "none", endArrowhead: "arrow", strokeStyle, label };
}

export function classToElements(source: string): AnyElement[] {
  const diagram = parseClassDiagram(source);
  const specs = new Map(diagram.nodes.map((node) => [node.id, specOf(node)] as const));
  const input: LayoutInput = {
    direction: "TB",
    nodes: diagram.nodes.map((node) => ({ id: node.id, ...measureCompartment(specs.get(node.id)!) })),
    edges: diagram.edges.map((edge) => ({ from: edge.from, to: edge.to, index: edge.index, minlen: 1 })),
  };
  const layout = layoutFlowchart(input);

  const elements: AnyElement[] = [];
  for (const node of diagram.nodes) {
    const box = layout.nodes.get(node.id);
    if (box) elements.push(...createCompartmentElements(box, specs.get(node.id)!, `mermaid-${node.id}`));
  }
  for (const edge of diagram.edges) {
    const points = layout.edges.get(edge.index);
    if (points) {
      elements.push(
        ...createEdgeElements(points, edgeVisual(edge.relation, edge.dashed, edge.label), `mermaid-edge-${edge.from}-${edge.to}`),
      );
    }
  }
  return elements;
}
