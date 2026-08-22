/**
 * Cluster walls (dagre's compound-graph border nodes). Bounding-box frames only work if nothing
 * foreign ever sits inside a subgraph's rectangle — per-rank contiguity alone can't guarantee that
 * across ranks. So, for every subgraph, this stage inserts a near-zero-width *wall* dummy at the left
 * and right edge of the cluster on every rank the cluster spans (members, member-to-member edge
 * dummies, and nested children included). The ordering stage pins walls to the edges of the cluster's
 * contiguous block, the coordinate stage separates outside nodes from them like any other node and
 * then vertically aligns each wall chain — reserving an exclusive rectangular corridor per cluster,
 * which is exactly what makes the emitted frames disjoint.
 */
import { DUMMY_SIZE, type EdgeChain, type LayoutInput, type LayoutNode } from "./types";

/** Left/right wall node ids per cluster, index-aligned by rank offset within the cluster's span. */
export interface ClusterWalls {
  left: string[];
  right: string[];
}

export interface ClusterInfo {
  /** Cluster nesting path (outermost → innermost) per node id; singletons for ungrouped nodes. */
  pathOf: (id: string) => readonly string[];
  /** "L" / "R" for wall nodes, undefined for everything else. */
  wallSideOf: (id: string) => "L" | "R" | undefined;
  /** Wall node ids per cluster id (empty when the input has no groups). */
  walls: Map<string, ClusterWalls>;
  /** Consecutive-rank wall pairs, fed into the ordering adjacency so wall chains stay straight. */
  links: [string, string][];
}

const NO_PATH: readonly string[] = [];

/** Builds the outermost→innermost cluster path for a cluster id via the parent map. */
function clusterChain(cluster: string, parents: Map<string, string>): string[] {
  const path = [cluster];
  const seen = new Set(path);
  let parent = parents.get(cluster);
  while (parent !== undefined && !seen.has(parent)) {
    path.unshift(parent);
    seen.add(parent);
    parent = parents.get(parent);
  }
  return path;
}

export function insertClusterWalls(
  input: LayoutInput,
  nodes: Map<string, LayoutNode>,
  chains: EdgeChain[],
): ClusterInfo {
  const groups = input.groups ?? new Map<string, string>();
  const parents = input.groupParents ?? new Map<string, string>();

  // Full nesting path per cluster id, then per member node id.
  const chainMemo = new Map<string, readonly string[]>();
  const pathOfCluster = (cluster: string): readonly string[] => {
    const memo = chainMemo.get(cluster);
    if (memo) return memo;
    const path = clusterChain(cluster, parents);
    chainMemo.set(cluster, path);
    return path;
  };
  const pathByNode = new Map<string, readonly string[]>();
  for (const [nodeId, cluster] of groups) pathByNode.set(nodeId, pathOfCluster(cluster));

  // Edge dummies inherit the deepest cluster shared by both endpoints, so a member-to-member edge
  // routes inside the cluster while cross-cluster edges stay outside the walls.
  for (const chain of chains) {
    if (chain.selfLoop || chain.nodes.length < 3) continue;
    const fromPath = pathByNode.get(chain.nodes[0]!) ?? NO_PATH;
    const toPath = pathByNode.get(chain.nodes[chain.nodes.length - 1]!) ?? NO_PATH;
    let depth = 0;
    while (depth < fromPath.length && depth < toPath.length && fromPath[depth] === toPath[depth]) depth++;
    if (depth === 0) continue;
    const shared = fromPath.slice(0, depth);
    for (let i = 1; i < chain.nodes.length - 1; i++) pathByNode.set(chain.nodes[i]!, shared);
  }

  // Rank span per cluster: every rank any member (node or inherited dummy) occupies, widened so each
  // parent covers its children. Spans may interleave with foreign ranks — walls handle those ranks too.
  const span = new Map<string, { min: number; max: number }>();
  for (const [nodeId, path] of pathByNode) {
    const rank = nodes.get(nodeId)?.rank;
    if (rank === undefined) continue;
    for (const cluster of path) {
      const s = span.get(cluster);
      if (!s) span.set(cluster, { min: rank, max: rank });
      else {
        s.min = Math.min(s.min, rank);
        s.max = Math.max(s.max, rank);
      }
    }
  }

  const walls = new Map<string, ClusterWalls>();
  const links: [string, string][] = [];
  const wallSide = new Map<string, "L" | "R">();
  for (const [cluster, s] of span) {
    const path = pathOfCluster(cluster);
    const left: string[] = [];
    const right: string[] = [];
    for (let rank = s.min; rank <= s.max; rank++) {
      for (const side of ["L", "R"] as const) {
        const id = `__w${side}:${cluster}:${rank}`;
        nodes.set(id, { id, width: DUMMY_SIZE, height: DUMMY_SIZE, rank, order: 0, along: 0, isDummy: true });
        pathByNode.set(id, path);
        wallSide.set(id, side);
        (side === "L" ? left : right).push(id);
      }
    }
    for (let i = 0; i < left.length - 1; i++) links.push([left[i]!, left[i + 1]!], [right[i]!, right[i + 1]!]);
    walls.set(cluster, { left, right });
  }

  return {
    pathOf: (id) => pathByNode.get(id) ?? NO_PATH,
    wallSideOf: (id) => wallSide.get(id),
    walls,
    links,
  };
}
