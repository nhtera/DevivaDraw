/**
 * Ordering / crossing minimization (dagre stage 4). Builds the per-rank node lists and the north/south
 * adjacency from the edge chains (plus cluster wall links), seeds an initial order by BFS from the
 * roots, then iterates the weighted-median heuristic (Gansner et al.) alternating down/up sweeps plus
 * adjacent-swap transposition, keeping the lowest-crossing arrangement seen. Cluster handling is
 * hierarchical: a rank sorts by the outermost differing cluster's mean median, so every (nested)
 * cluster stays a contiguous block, and each cluster's wall nodes are pinned to its block edges after
 * every reorder. Deterministic: stable tie-breaks by cluster id and current index everywhere.
 */
import { byClusterPath, eachPrefix, pathKeyOf } from "./cluster-path-sort";
import { runTranspose, transpose } from "./transpose";
import type { ClusterInfo } from "./cluster-walls";
import { countCrossings } from "./crossings";
import type { EdgeChain, LayoutNode } from "./types";

export interface OrderResult {
  ranks: string[][];
  down: Map<string, string[]>;
  up: Map<string, string[]>;
}

function buildAdjacency(chains: EdgeChain[], extraLinks: [string, string][]): { down: Map<string, string[]>; up: Map<string, string[]> } {
  const down = new Map<string, string[]>();
  const up = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    (down.get(a) ?? down.set(a, []).get(a)!).push(b);
    (up.get(b) ?? up.set(b, []).get(b)!).push(a);
  };
  for (const chain of chains) {
    if (chain.selfLoop) continue;
    for (let i = 0; i < chain.nodes.length - 1; i++) link(chain.nodes[i]!, chain.nodes[i + 1]!);
  }
  for (const [a, b] of extraLinks) link(a, b);
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
 * Reorders each rank toward the median of its neighbors in the adjacent fixed rank, comparing via
 * `byClusterPath` over cluster mean medians so whole (nested) clusters move together.
 */
function wmedianSweep(ranks: string[][], fixedAdj: Map<string, string[]>, topDown: boolean, cluster: ClusterInfo): void {
  const rankIndexes = topDown ? [...ranks.keys()] : [...ranks.keys()].reverse();
  for (const r of rankIndexes) {
    const posInFixed = new Map<string, number>();
    const fixedRank = ranks[topDown ? r - 1 : r + 1];
    if (fixedRank) fixedRank.forEach((id, i) => posInFixed.set(id, i));
    const scored = ranks[r]!.map((id, idx) => {
      const neighbors = (fixedAdj.get(id) ?? []).map((n) => posInFixed.get(n)).filter((p): p is number => p !== undefined);
      const median = medianValue(neighbors);
      return { id, med: median < 0 ? idx : median, idx, path: pathKeyOf(cluster, id) };
    });
    const sum = new Map<string, number>();
    const count = new Map<string, number>();
    const firstIndex = new Map<string, number>();
    for (const s of scored) {
      eachPrefix(s.path, (key) => {
        sum.set(key, (sum.get(key) ?? 0) + s.med);
        count.set(key, (count.get(key) ?? 0) + 1);
        if (!firstIndex.has(key)) firstIndex.set(key, s.idx);
      });
    }
    scored.sort(
      byClusterPath(
        (key) => sum.get(key)! / count.get(key)!,
        (s) => s.med,
        (key) => firstIndex.get(key)!,
        (s) => s.idx,
      ),
    );
    ranks[r] = scored.map((s) => s.id);
  }
}

/**
 * Stable-reorders each rank so every cluster (at every nesting level) forms a contiguous block,
 * keeping the relative order established by the BFS seed. Blocks order by their first appearance.
 */
function makeContiguous(ranks: string[][], cluster: ClusterInfo): void {
  for (let r = 0; r < ranks.length; r++) {
    const firstIndex = new Map<string, number>();
    const items = ranks[r]!.map((id, idx) => {
      const path = pathKeyOf(cluster, id);
      eachPrefix(path, (key) => {
        if (!firstIndex.has(key)) firstIndex.set(key, idx);
      });
      return { id, med: idx, idx, path };
    });
    items.sort(
      byClusterPath(
        (key) => firstIndex.get(key)!,
        (s) => s.idx,
        (key) => firstIndex.get(key)!,
        (s) => s.idx,
      ),
    );
    ranks[r] = items.map((s) => s.id);
  }
}

/** Moves each cluster's wall nodes to the edges of its contiguous block on every rank. */
function pinWalls(ranks: string[][], cluster: ClusterInfo): void {
  if (cluster.walls.size === 0) return;
  const depthOf = (c: string): number => cluster.pathOf(cluster.walls.get(c)!.left[0]!).length;
  const clustersByDepth = [...cluster.walls.keys()].sort((a, b) => depthOf(a) - depthOf(b));
  for (const rank of ranks) {
    for (const c of clustersByDepth) {
      let start = -1;
      let end = -1;
      let leftWall = -1;
      let rightWall = -1;
      for (let i = 0; i < rank.length; i++) {
        const id = rank[i]!;
        if (!cluster.pathOf(id).includes(c)) continue;
        if (start === -1) start = i;
        end = i;
        const side = cluster.wallSideOf(id);
        if (side === "L" && id.startsWith(`__wL:${c}:`)) leftWall = i;
        else if (side === "R" && id.startsWith(`__wR:${c}:`)) rightWall = i;
      }
      if (start === -1) continue;
      if (leftWall > start) {
        const [wall] = rank.splice(leftWall, 1);
        rank.splice(start, 0, wall!);
        if (rightWall !== -1 && rightWall < leftWall) rightWall++;
      }
      if (rightWall !== -1 && rightWall < end) {
        const [wall] = rank.splice(rightWall, 1);
        rank.splice(end, 0, wall!);
      }
    }
  }
}

export function orderRanks(nodes: Map<string, LayoutNode>, maxRank: number, chains: EdgeChain[], cluster: ClusterInfo): OrderResult {
  const { down, up } = buildAdjacency(chains, cluster.links);
  const ranks = initialRanks(nodes, maxRank, down);
  makeContiguous(ranks, cluster);
  pinWalls(ranks, cluster);
  let best = ranks.map((r) => [...r]);
  let bestCrossings = countCrossings(ranks, down);

  for (let iter = 0; iter < 8 && bestCrossings > 0; iter++) {
    const topDown = iter % 2 === 0;
    wmedianSweep(ranks, topDown ? up : down, topDown, cluster);
    pinWalls(ranks, cluster);
    transpose(ranks, down, cluster);
    runTranspose(ranks, down, cluster);
    const crossings = countCrossings(ranks, down);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = ranks.map((r) => [...r]);
    }
  }

  best.forEach((rank) => rank.forEach((id, order) => (nodes.get(id)!.order = order)));
  return { ranks: best, down, up };
}
