/**
 * Shared types + tunables for the from-scratch layered (Sugiyama/dagre) layout. The pipeline is a
 * chain of pure stages — acyclic → rank → dummy nodes → order → coordinates → route — each in its own
 * module, operating on these structures. Everything is deterministic (no randomness) so the same
 * source always produces the same diagram.
 */
import type { FlowDirection } from "../parse/flowchart-ir";

/** Re-exported so a consumer of `LayoutInput` can name the type of its `direction` field without reaching past this module. */
export type { FlowDirection };

export interface LayoutInput {
  nodes: { id: string; width: number; height: number }[];
  edges: { from: string; to: string; index: number; minlen: number }[];
  direction: FlowDirection;
  /** nodeId → innermost subgraph id, so the layout keeps subgraph members clustered. Optional. */
  groups?: Map<string, string>;
  /** subgraphId → parent subgraph id for nested subgraphs, so cluster handling nests. Optional. */
  groupParents?: Map<string, string>;
}

/** A node in the layout graph — a real IR node or an inserted dummy that bends a long edge. */
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  rank: number;
  order: number; // position within its rank
  along: number; // within-rank axis coordinate (centre), assigned by coordinate stage
  isDummy: boolean;
}

/** An oriented edge in the acyclic graph; `reversed` marks a former cycle-closing edge. */
export interface OrientedEdge {
  from: string;
  to: string;
  index: number;
  minlen: number;
  reversed: boolean;
}

/** One original edge's full node chain (source → dummies → target), in oriented (low→high rank) order. */
export interface EdgeChain {
  index: number;
  nodes: string[];
  reversed: boolean;
  selfLoop: boolean;
}

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  /** Top-left box per real node id, normalized so the diagram starts at (0,0). */
  nodes: Map<string, LayoutBox>;
  /** Polyline (scene coords, border-trimmed) per original edge index. */
  edges: Map<number, { x: number; y: number }[]>;
}

/** Minimum gap between two nodes sharing a rank (along-axis). */
export const NODE_SEP = 44;
/** Gap between consecutive ranks (cross-axis). */
export const RANK_GAP = 70;
/** Dummy nodes are near-zero width so long edges can pass between real nodes. */
export const DUMMY_SIZE = 1;
