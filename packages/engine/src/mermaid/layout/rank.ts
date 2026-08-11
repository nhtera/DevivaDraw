/**
 * Rank assignment (dagre stage 2). Longest-path ranking via Kahn topological relaxation over the
 * acyclic edges, honoring each edge's `minlen` (extra dashes push the target further down). Ranks are
 * 0-based and dense from the roots; disconnected nodes land at rank 0. The graph is already a DAG
 * (cycle removal ran first), so the topological pass always drains.
 */
import type { OrientedEdge } from "./types";

export function assignRanks(nodeIds: string[], edges: OrientedEdge[]): Map<string, number> {
  const rank = new Map<string, number>();
  const indegree = new Map<string, number>();
  const out = new Map<string, OrientedEdge[]>();
  for (const id of nodeIds) {
    rank.set(id, 0);
    indegree.set(id, 0);
  }
  for (const edge of edges) {
    (out.get(edge.from) ?? out.set(edge.from, []).get(edge.from)!).push(edge);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => indegree.get(id) === 0);
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]!;
    for (const edge of out.get(u) ?? []) {
      const candidate = rank.get(u)! + edge.minlen;
      if (candidate > rank.get(edge.to)!) rank.set(edge.to, candidate);
      const left = indegree.get(edge.to)! - 1;
      indegree.set(edge.to, left);
      if (left === 0) queue.push(edge.to);
    }
  }
  return rank;
}
