/**
 * Coordinate assignment (dagre stage 5, v1 — barycenter/priority). Assigns each node its within-rank
 * axis position: seed left-to-right by order, then iteratively pull every node toward the average
 * position of its neighbors (up + down) while a two-sided separation pass keeps rank-mates from
 * overlapping (gap = half-widths + `NODE_SEP`). Dummy nodes are ~zero width, so long edges pull nearly
 * straight. Deterministic and size-aware. Brandes–Köpf is a future drop-in upgrade behind this API.
 */
import type { ClusterWalls } from "./cluster-walls";
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

/**
 * Straightens each cluster's wall chains: every left wall snaps to the cluster's leftmost wall
 * position and every right wall to the rightmost, then a separation pass per rank pushes any
 * now-too-close outside nodes away. Iterated because widening one cluster can shift its neighbours.
 * Vertically aligned walls are what turn the per-rank corridors into one clean rectangle per cluster.
 */
function alignClusterWalls(nodes: Map<string, LayoutNode>, ranks: string[][], walls: Map<string, ClusterWalls>): void {
  if (walls.size === 0) return;
  // Every wall on one side of one cluster shares a single line variable, so alignment is exact by
  // construction. The lines and node positions then just need the separation constraints re-satisfied:
  // sweep every rank left-to-right, raising a node (or a shared line, which raises that cluster's
  // walls on every rank) whenever it sits too close to its left neighbour. Positions only ever grow,
  // each raise is forced by a constraint, and the constraint graph is finite — so this reaches the
  // unique leftmost feasible solution above the barycenter seed and terminates. The cap is a safety
  // net, not a tuning knob.
  interface Line {
    value: number;
    wallIds: string[];
  }
  const lineOf = new Map<string, Line>();
  const lines: Line[] = [];
  for (const w of walls.values()) {
    for (const side of [w.left, w.right]) {
      const line: Line = { value: -Infinity, wallIds: side };
      lines.push(line);
      for (const id of side) lineOf.set(id, line);
    }
  }

  // Lines start at -Infinity (no constraint) so the solve settles at the tightest feasible corridor
  // instead of inheriting drift from the barycenter passes. A -Infinity node contributes no
  // separation demand, so it simply doesn't constrain its right neighbour yet.
  const solve = (): void => {
    for (let pass = 0; pass < 200; pass++) {
      let changed = false;
      for (const rank of ranks) {
        let prev: LayoutNode | undefined;
        for (const id of rank) {
          const node = nodes.get(id)!;
          const line = lineOf.get(id);
          const min = prev === undefined ? -Infinity : prev.along + prev.width / 2 + node.width / 2 + NODE_SEP;
          if (line && line.value < min) {
            line.value = min;
            changed = true;
          }
          const along = line ? line.value : Math.max(node.along, min);
          if (node.along !== along) {
            node.along = along;
            changed = true;
          }
          prev = node;
        }
      }
      if (!changed) break;
    }
  };
  solve();

  // A cluster with nothing to its left on any spanned rank keeps a -Infinity line: snap it to hug the
  // item just inside the wall (skipping empty ranks where that item is the cluster's own far wall).
  // Fixing an inner cluster can make an outer one resolvable, hence the loop; depth bounds the rounds.
  const neighborInside = new Map<string, string>();
  for (const rank of ranks) {
    for (let i = 0; i < rank.length - 1; i++) {
      const line = lineOf.get(rank[i]!);
      if (line && line.value === -Infinity) neighborInside.set(rank[i]!, rank[i + 1]!);
    }
  }
  for (let round = 0; round < 10; round++) {
    let fixed = false;
    for (const line of lines) {
      if (line.value !== -Infinity) continue;
      let value = Infinity;
      for (const id of line.wallIds) {
        const inner = neighborInside.get(id);
        if (inner === undefined) continue;
        const innerLine = lineOf.get(inner);
        if (innerLine === lineOf.get(id)) continue;
        const innerAlong = innerLine ? innerLine.value : nodes.get(inner)!.along;
        if (innerAlong === -Infinity || innerAlong === Infinity) continue;
        const wall = nodes.get(id)!;
        const neighbor = nodes.get(inner)!;
        value = Math.min(value, innerAlong - neighbor.width / 2 - wall.width / 2 - NODE_SEP);
      }
      if (value !== Infinity) {
        line.value = value;
        fixed = true;
      }
    }
    if (!fixed) break;
    solve();
  }
}

export function assignCoordinates(
  nodes: Map<string, LayoutNode>,
  ranks: string[][],
  up: Map<string, string[]>,
  down: Map<string, string[]>,
  walls: Map<string, ClusterWalls> = new Map(),
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

  alignClusterWalls(nodes, ranks, walls);
}
