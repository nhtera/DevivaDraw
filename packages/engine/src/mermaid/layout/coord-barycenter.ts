/**
 * Coordinate assignment (dagre stage 5, v1 — barycenter/priority). Assigns each node its within-rank
 * axis position: seed left-to-right by order, then iteratively pull every node toward the average
 * position of its neighbors (up + down) while a two-sided separation pass keeps rank-mates from
 * overlapping (gap = half-widths + `NODE_SEP`). Dummy nodes are ~zero width, so long edges pull nearly
 * straight. Deterministic and size-aware. Brandes–Köpf is a future drop-in upgrade behind this API.
 */
import { NODE_SEP, type LayoutNode } from "./types";

/** Two feasible monotone sequences (pushed from each side), averaged — the mean is still feasible. */
function resolveSeparation(rankNodes: LayoutNode[], desired: number[]): number[] {
  const n = rankNodes.length;
  const left = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    left[i] = desired[i]!;
    if (i > 0) {
      const gap = rankNodes[i - 1]!.width / 2 + rankNodes[i]!.width / 2 + NODE_SEP;
      left[i] = Math.max(left[i]!, left[i - 1]! + gap);
    }
  }
  const right = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    right[i] = desired[i]!;
    if (i < n - 1) {
      const gap = rankNodes[i]!.width / 2 + rankNodes[i + 1]!.width / 2 + NODE_SEP;
      right[i] = Math.min(right[i]!, right[i + 1]! - gap);
    }
  }
  return rankNodes.map((_, i) => (left[i]! + right[i]!) / 2);
}

export function assignCoordinates(
  nodes: Map<string, LayoutNode>,
  ranks: string[][],
  up: Map<string, string[]>,
  down: Map<string, string[]>,
): void {
  for (const rank of ranks) {
    let cursor = 0;
    for (const id of rank) {
      const node = nodes.get(id)!;
      node.along = cursor + node.width / 2;
      cursor += node.width + NODE_SEP;
    }
  }

  for (let pass = 0; pass < 8; pass++) {
    for (const rank of ranks) {
      if (rank.length === 0) continue;
      const desired = rank.map((id) => {
        const neighbors = [...(up.get(id) ?? []), ...(down.get(id) ?? [])].map((n) => nodes.get(n)!.along);
        return neighbors.length ? neighbors.reduce((a, b) => a + b, 0) / neighbors.length : nodes.get(id)!.along;
      });
      const resolved = resolveSeparation(
        rank.map((id) => nodes.get(id)!),
        desired,
      );
      rank.forEach((id, i) => (nodes.get(id)!.along = resolved[i]!));
    }
  }
}
