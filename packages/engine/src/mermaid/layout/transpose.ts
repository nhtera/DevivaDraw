/**
 * Transposition refinements for the ordering stage: adjacent-exchange passes that keep whatever
 * lowers the crossing count. `transpose` swaps same-cluster neighbours item by item; `runTranspose`
 * swaps whole adjacent top-level runs (cluster blocks and solo items) — the cross-block move the
 * per-item pass deliberately never makes, without which a lone edge dummy seeded on the wrong side
 * of a cluster stays walled off there and its edge detours around the cluster's corridor.
 */
import { pathKeyOf } from "./cluster-path-sort";
import type { ClusterInfo } from "./cluster-walls";
import { rankPairCrossings } from "./crossings";

/** Adjacent-swap pass: swaps same-cluster neighbours while it reduces crossings. Cross-cluster swaps
 *  and wall nodes are skipped so cluster contiguity and pinned walls survive. */
export function transpose(ranks: string[][], down: Map<string, string[]>, cluster: ClusterInfo): void {
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 4) {
    improved = false;
    for (let r = 0; r < ranks.length; r++) {
      const rank = ranks[r]!;
      for (let i = 0; i < rank.length - 1; i++) {
        if (cluster.wallSideOf(rank[i]!) !== undefined || cluster.wallSideOf(rank[i + 1]!) !== undefined) continue;
        const pathA = pathKeyOf(cluster, rank[i]!);
        const pathB = pathKeyOf(cluster, rank[i + 1]!);
        if (pathA.length !== pathB.length || pathA.some((c, d) => c !== pathB[d])) continue; // don't split a cluster
        const before = boundaryCrossings(ranks, r, down);
        [rank[i], rank[i + 1]] = [rank[i + 1]!, rank[i]!];
        if (boundaryCrossings(ranks, r, down) < before) improved = true;
        else [rank[i], rank[i + 1]] = [rank[i + 1]!, rank[i]!]; // revert
      }
    }
  }
}

/** Maximal consecutive runs of one rank sharing the same top-level cluster (solos are their own runs). */
function topRuns(rank: string[], cluster: ClusterInfo): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  for (let i = 0; i < rank.length; i++) {
    const key = pathKeyOf(cluster, rank[i]!)[0]!;
    if (runs.length > 0 && pathKeyOf(cluster, rank[runs[runs.length - 1]!.start]!)[0] === key) runs[runs.length - 1]!.end = i;
    else runs.push({ start: i, end: i });
  }
  return runs;
}

/**
 * Swaps *adjacent top-level runs* — whole cluster blocks and solo items — when that lowers crossings.
 * This is the cross-block move the per-item transpose deliberately never makes; without it a lone edge
 * dummy that seeds on the wrong side of a cluster stays walled off there and its edge detours around
 * the cluster's corridor.
 */
export function runTranspose(ranks: string[][], down: Map<string, string[]>, cluster: ClusterInfo): void {
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 4) {
    improved = false;
    for (let r = 0; r < ranks.length; r++) {
      for (let i = 0; ; i++) {
        const rank = ranks[r]!;
        const runs = topRuns(rank, cluster);
        if (i >= runs.length - 1) break;
        const a = runs[i]!;
        const b = runs[i + 1]!;
        const before = boundaryCrossings(ranks, r, down);
        ranks[r] = [...rank.slice(0, a.start), ...rank.slice(b.start, b.end + 1), ...rank.slice(a.start, a.end + 1), ...rank.slice(b.end + 1)];
        if (boundaryCrossings(ranks, r, down) < before) improved = true;
        else ranks[r] = rank; // revert
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
