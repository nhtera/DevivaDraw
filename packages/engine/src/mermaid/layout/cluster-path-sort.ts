/**
 * Cluster-path sorting utilities for the ordering stage. A node's cluster path (outermost →
 * innermost subgraph) decides where it may sit in a rank: sorting with `byClusterPath` keeps every
 * nesting level a contiguous block, because two items only ever compare by the outermost cluster
 * where their paths part ways.
 */
import type { ClusterInfo } from "./cluster-walls";

/** Joins cluster-path segments into unambiguous prefix keys. */
const PATH_SEP = "\u001F";

/** A rank item ready for cluster-aware sorting: its sweep median, current index, and cluster path. */
export interface PathScored {
  id: string;
  med: number;
  idx: number;
  path: readonly string[];
}

/** Cluster path of an id, with ungrouped ids (and unassigned dummies) as their own singleton cluster. */
export function pathKeyOf(cluster: ClusterInfo, id: string): readonly string[] {
  const path = cluster.pathOf(id);
  return path.length > 0 ? path : [`__solo:${id}`];
}

/** Walks `path`, feeding every cumulative prefix key (levels joined by PATH_SEP) to `visit`. */
export function eachPrefix(path: readonly string[], visit: (key: string) => void): void {
  let key = "";
  for (const c of path) {
    key = key === "" ? c : key + PATH_SEP + c;
    visit(key);
  }
}

/**
 * Hierarchical cluster comparator: at the outermost level where two items' cluster paths differ, each
 * side compares by its cluster's aggregate value from `groupValue` (an item with no cluster at that
 * depth uses `selfValue`); ties break by `groupTie`/`selfTie` — typically first-appearance order, so
 * a tie keeps the current arrangement instead of biasing by id spelling. Sorting a rank with this
 * keeps every nesting level a contiguous block while whole blocks move by their aggregate.
 */
export function byClusterPath(
  groupValue: (key: string) => number,
  selfValue: (s: PathScored) => number,
  groupTie: (key: string) => number,
  selfTie: (s: PathScored) => number,
) {
  return (a: PathScored, b: PathScored): number => {
    let keyA = "";
    let keyB = "";
    const depth = Math.max(a.path.length, b.path.length);
    for (let i = 0; i < depth; i++) {
      const ca = a.path[i];
      const cb = b.path[i];
      if (ca !== undefined) keyA = keyA === "" ? ca : keyA + PATH_SEP + ca;
      if (cb !== undefined) keyB = keyB === "" ? cb : keyB + PATH_SEP + cb;
      if (ca === cb) continue;
      const va = ca === undefined ? selfValue(a) : groupValue(keyA);
      const vb = cb === undefined ? selfValue(b) : groupValue(keyB);
      if (va !== vb) return va - vb;
      const ta = ca === undefined ? selfTie(a) : groupTie(keyA);
      const tb = cb === undefined ? selfTie(b) : groupTie(keyB);
      if (ta !== tb) return ta - tb;
    }
    return a.med - b.med || a.idx - b.idx;
  };
}
