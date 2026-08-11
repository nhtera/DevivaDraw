/**
 * The layered-layout pipeline entry point: runs the from-scratch dagre stages in order and returns
 * positioned node boxes + border-trimmed edge polylines, normalized to (0,0). Pure and deterministic.
 * acyclic → rank → dummy nodes → order (crossing-min) → coordinates → route.
 */
import { makeAcyclic } from "./acyclic";
import { assignCoordinates } from "./coord-barycenter";
import { insertDummies } from "./dummy-nodes";
import { orderRanks } from "./order";
import { assignRanks } from "./rank";
import { route } from "./route";
import type { LayoutInput, LayoutResult } from "./types";

export function layoutFlowchart(input: LayoutInput): LayoutResult {
  if (input.nodes.length === 0) return { nodes: new Map(), edges: new Map() };
  const acyclic = makeAcyclic(input);
  const rank = assignRanks(
    input.nodes.map((n) => n.id),
    acyclic.edges,
  );
  const { nodes, chains, maxRank } = insertDummies(input, acyclic, rank);
  const { ranks, up, down } = orderRanks(nodes, maxRank, chains);
  assignCoordinates(nodes, ranks, up, down);
  return route(nodes, maxRank, chains, input.direction);
}
