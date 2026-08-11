/**
 * Ordering / crossing minimization (dagre stage 4). Builds the per-rank node lists and the north/south
 * adjacency from the edge chains, seeds an initial order by BFS from the roots (clusters connected
 * components), then iterates the weighted-median heuristic (Gansner et al.) alternating down/up sweeps
 * plus adjacent-swap transposition, keeping the lowest-crossing arrangement seen. Deterministic:
 * stable tie-breaks by current index everywhere.
 */
import { countCrossings, rankPairCrossings } from "./crossings";
import type { EdgeChain, LayoutNode } from "./types";

export interface OrderResult {
  ranks: string[][];
  down: Map<string, string[]>;
  up: Map<string, string[]>;
}

function buildAdjacency(chains: EdgeChain[]): { down: Map<string, string[]>; up: Map<string, string[]> } {
  const down = new Map<string, string[]>();
  const up = new Map<string, string[]>();
  for (const chain of chains) {
    if (chain.selfLoop) continue;
    for (let i = 0; i < chain.nodes.length - 1; i++) {
      const a = chain.nodes[i]!;
      const b = chain.nodes[i + 1]!;
      (down.get(a) ?? down.set(a, []).get(a)!).push(b);
      (up.get(b) ?? up.set(b, []).get(b)!).push(a);
    }
  }
  return { down, up };
}

/** Seeds each rank's order by BFS from rank-0 nodes so connected nodes sit near each other. */
function initialRanks(nodes: Map<string, LayoutNode>, maxRank: number, down: Map<string, string[]>): string[][] {
  const ranks: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  const seen = new Set<string>();
  const roots = [...nodes.values()].filter((n) => n.rank === 0).map((n) => n.id);
  const queue = [...roots];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    if (seen.has(id)) continue;
    seen.add(id);
    ranks[nodes.get(id)!.rank]!.push(id);
    for (const next of down.get(id) ?? []) if (!seen.has(next)) queue.push(next);
  }
  for (const node of nodes.values()) if (!seen.has(node.id)) ranks[node.rank]!.push(node.id); // stragglers
  return ranks;
}

function medianValue(neighbors: number[]): number {
  if (neighbors.length === 0) return -1;
  const sorted = [...neighbors].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  if (sorted.length === 2) return (sorted[0]! + sorted[1]!) / 2;
  const left = sorted[mid - 1]! - sorted[0]!;
  const right = sorted[sorted.length - 1]! - sorted[mid]!;
  return left + right === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : (sorted[mid - 1]! * right + sorted[mid]! * left) / (left + right);
}

/**
 * Reorders each rank toward the median of its neighbors in the adjacent fixed rank. Subgraph members
 * are kept contiguous by treating each cluster as a super-node: nodes sort by their cluster's mean
 * median first (so a whole cluster moves together), then by their own median within the cluster.
 */
function wmedianSweep(
  ranks: string[][],
  fixedAdj: Map<string, string[]>,
  topDown: boolean,
  clusterOf: (id: string) => string,
): void {
  const rankIndexes = topDown ? [...ranks.keys()] : [...ranks.keys()].reverse();
  for (const r of rankIndexes) {
    const posInFixed = new Map<string, number>();
    const fixedRank = ranks[topDown ? r - 1 : r + 1];
    if (fixedRank) fixedRank.forEach((id, i) => posInFixed.set(id, i));
    const scored = ranks[r]!.map((id, idx) => {
      const neighbors = (fixedAdj.get(id) ?? []).map((n) => posInFixed.get(n)).filter((p): p is number => p !== undefined);
      const median = medianValue(neighbors);
      return { id, med: median < 0 ? idx : median, idx, cluster: clusterOf(id) };
    });
    const sum = new Map<string, number>();
    const count = new Map<string, number>();
    for (const s of scored) {
      sum.set(s.cluster, (sum.get(s.cluster) ?? 0) + s.med);
      count.set(s.cluster, (count.get(s.cluster) ?? 0) + 1);
    }
    const clusterKey = (c: string): number => sum.get(c)! / count.get(c)!;
    scored.sort(
      (a, b) =>
        clusterKey(a.cluster) - clusterKey(b.cluster) ||
        (a.cluster < b.cluster ? -1 : a.cluster > b.cluster ? 1 : 0) ||
        a.med - b.med ||
        a.idx - b.idx,
    );
    ranks[r] = scored.map((s) => s.id);
  }
}

/** Adjacent-swap pass: swaps same-cluster neighbours while it reduces crossings (cross-cluster swaps
 *  are skipped to preserve subgraph contiguity established by the median sweep). */
function transpose(ranks: string[][], down: Map<string, string[]>, clusterOf: (id: string) => string): void {
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 4) {
    improved = false;
    for (let r = 0; r < ranks.length; r++) {
      const rank = ranks[r]!;
      for (let i = 0; i < rank.length - 1; i++) {
        if (clusterOf(rank[i]!) !== clusterOf(rank[i + 1]!)) continue; // don't split a cluster
        const before = boundaryCrossings(ranks, r, down);
        [rank[i], rank[i + 1]] = [rank[i + 1]!, rank[i]!];
        if (boundaryCrossings(ranks, r, down) < before) improved = true;
        else [rank[i], rank[i + 1]] = [rank[i + 1]!, rank[i]!]; // revert
      }
    }
  }
}

/** Crossings on the two rank boundaries touching rank `r`. */
function boundaryCrossings(ranks: string[][], r: number, down: Map<string, string[]>): number {
  let sum = 0;
  if (r > 0) sum += rankPairCrossings(ranks[r - 1]!, ranks[r]!, down);
  if (r < ranks.length - 1) sum += rankPairCrossings(ranks[r]!, ranks[r + 1]!, down);
  return sum;
}

export function orderRanks(
  nodes: Map<string, LayoutNode>,
  maxRank: number,
  chains: EdgeChain[],
  groups: Map<string, string>,
): OrderResult {
  const { down, up } = buildAdjacency(chains);
  // Ungrouped nodes (and dummies) each form their own singleton cluster so they order freely; real
  // subgraph members share their subgraph id and are kept contiguous.
  const clusterOf = (id: string): string => groups.get(id) ?? `__${id}`;
  const ranks = initialRanks(nodes, maxRank, down);
  let best = ranks.map((r) => [...r]);
  let bestCrossings = countCrossings(ranks, down);

  for (let iter = 0; iter < 8 && bestCrossings > 0; iter++) {
    const topDown = iter % 2 === 0;
    wmedianSweep(ranks, topDown ? up : down, topDown, clusterOf);
    transpose(ranks, down, clusterOf);
    const crossings = countCrossings(ranks, down);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = ranks.map((r) => [...r]);
    }
  }

  best.forEach((rank) => rank.forEach((id, order) => (nodes.get(id)!.order = order)));
  return { ranks: best, down, up };
}
