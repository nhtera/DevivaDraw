/**
 * Cluster-aware rank assignment (dagre's nesting-graph idea). Plain longest-path ranking drops every
 * source node to rank 0, which smears all clusters across the same top ranks — the layout then has to
 * place the clusters side by side and the diagram sprawls horizontally. This stage ranks an augmented
 * graph instead: a virtual root plus borderTop/borderBottom nodes per cluster, tied to members by
 * heavily-weighted edges. Minimizing weighted edge length (greedy slack-window descent — a practical
 * stand-in for dagre's network simplex) squeezes each cluster into a tight rank band and pulls free
 * sources down beside their successors, so clusters stack the way the edges flow. Borders and the
 * root are dropped afterwards and the surviving ranks compressed to be dense.
 */
import type { OrientedEdge } from "./types";

interface WeightedEdge {
  from: string;
  to: string;
  minlen: number;
  weight: number;
}

const ROOT = "__nest:root";
const borderTop = (c: string): string => `__nest:bt:${c}`;
const borderBottom = (c: string): string => `__nest:bb:${c}`;

/** Longest-path ranking over a DAG (Kahn relaxation) — the feasible starting point for the descent. */
function longestPath(nodeIds: string[], edges: WeightedEdge[]): Map<string, number> {
  const rank = new Map<string, number>();
  const indegree = new Map<string, number>();
  const out = new Map<string, WeightedEdge[]>();
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

/**
 * Network simplex (Gansner et al.): minimizes Σ weight·(length − minlen) over all rankings that
 * respect every edge's minlen. Starts from a tight spanning tree over the longest-path ranking, then
 * repeatedly finds a tree edge whose *cut value* is negative — meaning the two components it separates
 * would be cheaper shifted closer — and pivots: shift one component by the entering edge's slack and
 * swap the edges. Components are recomputed by BFS per pivot; at diagram scale that brute force is
 * cheap and keeps the code short. Deterministic: first negative tree edge, minimum-slack entering
 * edge with index tie-break.
 */
function networkSimplex(nodeIds: string[], edges: WeightedEdge[], rank: Map<string, number>): void {
  const slack = (e: WeightedEdge): number => rank.get(e.to)! - rank.get(e.from)! - e.minlen;

  // Grow a spanning tree of tight edges, shifting the grown part so each added edge becomes tight.
  const inTree = new Set<string>([nodeIds[0]!]);
  const treeEdges = new Set<number>();
  while (inTree.size < nodeIds.length) {
    let best = -1;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      if (inTree.has(e.from) === inTree.has(e.to)) continue;
      if (best === -1 || slack(e) < slack(edges[best]!)) best = i;
    }
    if (best === -1) break; // disconnected input — the root edges normally prevent this
    const e = edges[best]!;
    const delta = inTree.has(e.from) ? slack(e) : -slack(e);
    for (const id of inTree) rank.set(id, rank.get(id)! + delta);
    inTree.add(inTree.has(e.from) ? e.to : e.from);
    treeEdges.add(best);
  }

  // Undirected tree adjacency, rebuilt only when the tree changes.
  const buildAdj = (): Map<string, { peer: string; index: number }[]> => {
    const adj = new Map<string, { peer: string; index: number }[]>();
    for (const index of treeEdges) {
      const e = edges[index]!;
      (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push({ peer: e.to, index });
      (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push({ peer: e.from, index });
    }
    return adj;
  };

  /** Nodes on `seed`'s side of the tree when tree edge `cutIndex` is removed. */
  const componentOf = (seed: string, cutIndex: number, adj: Map<string, { peer: string; index: number }[]>): Set<string> => {
    const seen = new Set([seed]);
    const queue = [seed];
    for (let head = 0; head < queue.length; head++) {
      for (const { peer, index } of adj.get(queue[head]!) ?? []) {
        if (index === cutIndex || seen.has(peer)) continue;
        seen.add(peer);
        queue.push(peer);
      }
    }
    return seen;
  };

  for (let pivot = 0; pivot < 4 * edges.length + 16; pivot++) {
    const adj = buildAdj();
    let done = true;
    for (const index of treeEdges) {
      const tree = edges[index]!;
      const fromSide = componentOf(tree.from, index, adj);
      let cut = 0;
      for (const e of edges) {
        const a = fromSide.has(e.from);
        const b = fromSide.has(e.to);
        if (a && !b) cut += e.weight;
        else if (!a && b) cut -= e.weight;
      }
      if (cut >= 0) continue;
      // Entering edge: cheapest-to-tighten edge pointing against the cut (to-side → from-side).
      let enter = -1;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]!;
        if (treeEdges.has(i) || fromSide.has(e.from) || !fromSide.has(e.to)) continue;
        if (enter === -1 || slack(e) < slack(edges[enter]!)) enter = i;
      }
      if (enter === -1) continue; // unbounded direction can't happen: the cut is negative, so such an edge exists
      const delta = slack(edges[enter]!);
      for (const id of nodeIds) if (!fromSide.has(id)) rank.set(id, rank.get(id)! + delta);
      treeEdges.delete(index);
      treeEdges.add(enter);
      done = false;
      break;
    }
    if (done) break;
  }
}

/**
 * Ranks real nodes honoring cluster nesting. `groups` maps node → innermost cluster, `groupParents`
 * maps cluster → parent cluster. Returns dense 0-based ranks for the real nodes only.
 */
export function assignNestedRanks(
  nodeIds: string[],
  edges: OrientedEdge[],
  groups: Map<string, string>,
  groupParents: Map<string, string>,
): Map<string, number> {
  // Collect every cluster id and its depth (top-level = 1).
  const clusters = new Set<string>([...groups.values(), ...groupParents.keys()]);
  for (const parent of groupParents.values()) clusters.add(parent);
  const depthOf = (c: string): number => {
    let depth = 1;
    let parent = groupParents.get(c);
    const seen = new Set([c]);
    while (parent !== undefined && !seen.has(parent)) {
      depth++;
      seen.add(parent);
      parent = groupParents.get(parent);
    }
    return depth;
  };
  let height = 1;
  for (const c of clusters) height = Math.max(height, depthOf(c));

  // Real edges get their rank space scaled so border ranks fit between bands; heavy border edges make
  // the descent prefer stretching a cross-cluster edge over inflating a cluster's own band.
  const scale = 2 * height + 1;
  const borderWeight = edges.length + 1;
  const augmented: WeightedEdge[] = edges.map((e) => ({ from: e.from, to: e.to, minlen: e.minlen * scale, weight: 1 }));
  const ids = [...nodeIds, ROOT];
  for (const c of clusters) {
    ids.push(borderTop(c), borderBottom(c));
    const parent = groupParents.get(c);
    if (parent !== undefined && clusters.has(parent)) {
      augmented.push(
        { from: borderTop(parent), to: borderTop(c), minlen: 1, weight: borderWeight },
        { from: borderBottom(c), to: borderBottom(parent), minlen: 1, weight: borderWeight },
      );
    } else {
      augmented.push({ from: ROOT, to: borderTop(c), minlen: 0, weight: 0 });
    }
  }
  for (const id of nodeIds) {
    const c = groups.get(id);
    if (c !== undefined && clusters.has(c)) {
      augmented.push(
        { from: borderTop(c), to: id, minlen: 1, weight: borderWeight },
        { from: id, to: borderBottom(c), minlen: 1, weight: borderWeight },
      );
    } else {
      augmented.push({ from: ROOT, to: id, minlen: 0, weight: 0 });
    }
  }

  const rank = longestPath(ids, augmented);
  networkSimplex(ids, augmented, rank);

  // Keep only real nodes and compress their ranks to a dense 0-based sequence.
  const used = [...new Set(nodeIds.map((id) => rank.get(id)!))].sort((a, b) => a - b);
  const dense = new Map(used.map((r, i) => [r, i]));
  const result = new Map<string, number>();
  for (const id of nodeIds) result.set(id, dense.get(rank.get(id)!)!);
  return result;
}
