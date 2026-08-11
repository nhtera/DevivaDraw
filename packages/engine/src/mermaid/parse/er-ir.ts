/** Render-agnostic IR for a Mermaid `erDiagram`. Produced by `parse-er.ts`. */

export interface EREntity {
  id: string;
  name: string;
  /** Raw attribute lines, e.g. `"string name PK"`. */
  attributes: string[];
  hasBody: boolean;
}

export interface EREdge {
  from: string;
  to: string;
  label?: string;
  /** Non-identifying relationships (`..`) render dashed; identifying (`--`) solid. */
  dashed: boolean;
  /** Human-readable cardinality at each end, e.g. `"1"`, `"0..N"` (crow's-foot glyphs not available). */
  startCard: string;
  endCard: string;
  index: number;
}

export interface ERDiagram {
  entities: EREntity[];
  edges: EREdge[];
}
