/**
 * Render-agnostic intermediate representation for a parsed Mermaid flowchart. The parser
 * (`parse-flowchart.ts`) produces this; Phase 02 mapping turns it into Deviva elements and Phase 03
 * lays it out. Keeping the IR free of any engine/render types is what lets the parser be pure and
 * unit-tested in isolation.
 */

export type FlowDirection = "TD" | "TB" | "BT" | "LR" | "RL";

/**
 * Every Mermaid flowchart node shape. The four at the end (`parallelogram*`, `trapezoid*`, `cylinder`,
 * `double-circle`) have no exact engine element yet — Phase 02 adds them; until then the mapper
 * approximates. Kept as the full set here so the parser never loses information.
 */
export type NodeShape =
  | "rectangle"
  | "rounded"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "double-circle"
  | "diamond"
  | "hexagon"
  | "parallelogram"
  | "parallelogram-alt"
  | "trapezoid"
  | "trapezoid-alt";

/** Arrowhead style at one end of an edge. `none` = a bare line end (`---`). */
export type Head = "none" | "arrow" | "circle" | "cross";

/** Line style of an edge, independent of its heads. */
export type EdgeKind = "arrow" | "open" | "dotted" | "thick" | "invisible";

export interface FlowNode {
  id: string;
  label: string;
  shape: NodeShape;
  /** `classDef` class names attached via `:::name` or `class A name`. */
  classes: string[];
  /** Raw inline `style A ...` declaration payload, resolved to element style in Phase 02. */
  styleRaw?: string;
  /** Id of the innermost subgraph this node was declared in, if any. */
  subgraphId?: string;
  /** `click A "url"` hyperlink target. */
  link?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  kind: EdgeKind;
  startHead: Head;
  endHead: Head;
  /** Minimum rank span for layout — grows with extra dashes (`--->` spans further than `-->`). */
  minlen: number;
  classes: string[];
  /** Declaration order, used to resolve `linkStyle <index>`. */
  index: number;
}

export interface FlowSubgraph {
  id: string;
  title?: string;
  direction?: FlowDirection;
  parentId?: string;
  nodeIds: string[];
}

/** A resolved `style`/`classDef` payload: css-ish `key:value` pairs (`fill`, `stroke`, ...). */
export interface StyleRule {
  target: string;
  props: Record<string, string>;
}

export interface LinkStyle {
  index: number | "default";
  props: Record<string, string>;
}

export interface Flowchart {
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
  subgraphs: FlowSubgraph[];
  styles: StyleRule[];
  classDefs: Map<string, StyleRule>;
  linkStyles: LinkStyle[];
}
