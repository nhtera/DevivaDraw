/** Render-agnostic IR for a Mermaid `stateDiagram` / `stateDiagram-v2`. Produced by `parse-state.ts`. */
import type { FlowDirection } from "./flowchart-ir";

export type StateKind = "state" | "start" | "end" | "choice" | "fork" | "join";

export interface StateNode {
  id: string;
  label: string;
  kind: StateKind;
  /** Innermost composite this node belongs to, or `undefined` at the top level. */
  parent?: string;
}

/** A composite (nested) state — a container drawn as a titled frame around its members. */
export interface StateComposite {
  id: string;
  title: string;
  parent?: string;
}

export interface StateEdge {
  from: string;
  to: string;
  label?: string;
  index: number;
}

export interface StateDiagram {
  direction: FlowDirection;
  nodes: StateNode[];
  composites: StateComposite[];
  edges: StateEdge[];
}
