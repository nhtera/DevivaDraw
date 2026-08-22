/**
 * The layered-layout pipeline entry point: runs the from-scratch dagre stages in order and returns
 * positioned node boxes + border-trimmed edge polylines, normalized to (0,0). Pure and deterministic.
 * acyclic → rank → dummy nodes → cluster walls → order (crossing-min) → coordinates → route.
 */
import { makeAcyclic } from "./acyclic";
import { insertClusterWalls } from "./cluster-walls";
import { assignCoordinates } from "./coord-barycenter";
import { insertDummies } from "./dummy-nodes";
import { assignNestedRanks } from "./nesting-rank";
import { orderRanks } from "./order";
import { assignRanks } from "./rank";
import { route } from "./route";
import type { LayoutInput, LayoutResult } from "./types";

export function layoutFlowchart(input: LayoutInput): LayoutResult {
  if (input.nodes.length === 0) return { nodes: new Map(), edges: new Map() };
  const acyclic = makeAcyclic(input);
  const nodeIds = input.nodes.map((n) => n.id);
  // Grouped graphs rank via the nesting graph so clusters stack in tight bands; ungrouped graphs
  // keep the plain longest-path ranking.
  const rank = input.groups?.size
    ? assignNestedRanks(nodeIds, acyclic.edges, input.groups, input.groupParents ?? new Map())
    : assignRanks(nodeIds, acyclic.edges);
  const { nodes, chains, maxRank } = insertDummies(input, acyclic, rank);
  const cluster = insertClusterWalls(input, nodes, chains);
  const { ranks, up, down } = orderRanks(nodes, maxRank, chains, cluster);
  assignCoordinates(nodes, ranks, up, down, cluster.walls);
  return route(nodes, maxRank, chains, input.direction);
}
