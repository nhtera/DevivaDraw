/**
 * Cycle removal (dagre stage 1). DFS back-edge detection: an edge pointing at a node still on the
 * recursion stack closes a cycle. Such edges are *reversed* so the rest of the pipeline sees a DAG;
 * the `reversed` flag is carried through so the router draws the arrowhead at the original target.
 * Self-loops are separated out for special routing.
 */
import type { LayoutInput, OrientedEdge } from "./types";

export interface AcyclicResult {
  edges: OrientedEdge[];
  selfLoops: number[];
}

function pushAdj(adj: Map<string, { to: string; index: number }[]>, from: string, entry: { to: string; index: number }): void {
  const list = adj.get(from);
  if (list) list.push(entry);
  else adj.set(from, [entry]);
}

export function makeAcyclic(input: LayoutInput): AcyclicResult {
  const adjacency = new Map<string, { to: string; index: number }[]>();
  for (const edge of input.edges) {
    if (edge.from !== edge.to) pushAdj(adjacency, edge.from, { to: edge.to, index: edge.index });
  }
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = explored
  const back = new Set<number>();
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const { to, index } of adjacency.get(id) ?? []) {
      const seen = state.get(to);
      if (seen === 1) back.add(index);
      else if (seen === undefined) visit(to);
    }
    state.set(id, 2);
  };
  for (const node of input.nodes) if (!state.has(node.id)) visit(node.id);

  const edges: OrientedEdge[] = [];
  const selfLoops: number[] = [];
  for (const edge of input.edges) {
    if (edge.from === edge.to) {
      selfLoops.push(edge.index);
    } else if (back.has(edge.index)) {
      edges.push({ from: edge.to, to: edge.from, index: edge.index, minlen: edge.minlen, reversed: true });
    } else {
      edges.push({ from: edge.from, to: edge.to, index: edge.index, minlen: edge.minlen, reversed: false });
    }
  }
  return { edges, selfLoops };
}
