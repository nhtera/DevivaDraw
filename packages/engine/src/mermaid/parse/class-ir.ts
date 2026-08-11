/** Render-agnostic IR for a Mermaid `classDiagram`. Produced by `parse-class.ts`. */

export type ClassRelation =
  | "inheritance"
  | "realization"
  | "composition"
  | "aggregation"
  | "association"
  | "dependency"
  | "link";

export interface ClassNode {
  id: string;
  name: string;
  attributes: string[];
  methods: string[];
  /** True when the class was declared with a `{ ... }` body, so empty compartments still render. */
  hasBody: boolean;
}

export interface ClassEdge {
  from: string;
  to: string;
  relation: ClassRelation;
  dashed: boolean;
  label?: string;
  index: number;
}

export interface ClassDiagram {
  nodes: ClassNode[];
  edges: ClassEdge[];
}
