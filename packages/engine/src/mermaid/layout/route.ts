/**
 * Direction transform + edge routing (dagre stage 6). Turns per-node `(along, rank)` into scene
 * `(x, y)` for the chart direction (TD/TB down, BT up, LR right, RL left), then builds each edge's
 * polyline from its node chain — source-border → dummy centres → target-border — trimming the end
 * segments to each node's box outline. Reversed edges are flipped back to original orientation so the
 * arrowhead lands on the true target; self-loops get a small side loop. Everything is normalized so
 * the diagram starts at (0,0).
 */
import type { EdgeChain, LayoutBox, LayoutNode, LayoutResult } from "./types";
import { RANK_GAP } from "./types";
import type { FlowDirection } from "../parse/flowchart-ir";

interface Point {
  x: number;
  y: number;
}

const SELF_LOOP = 34;

/** Cross-axis centre per rank = cumulative rank extents (tallest/widest node in each). */
function rankCenters(nodes: Map<string, LayoutNode>, maxRank: number, vertical: boolean): number[] {
  const extent = new Array<number>(maxRank + 1).fill(0);
  for (const node of nodes.values()) {
    const size = vertical ? node.height : node.width;
    extent[node.rank] = Math.max(extent[node.rank]!, size);
  }
  const center = new Array<number>(maxRank + 1);
  let cursor = 0;
  for (let r = 0; r <= maxRank; r++) {
    center[r] = cursor + extent[r]! / 2;
    cursor += extent[r]! + RANK_GAP;
  }
  return center;
}

/** Maps a node/dummy centre from (along, cross) into scene space for the given direction. */
function toScene(along: number, cross: number, direction: FlowDirection): Point {
  switch (direction) {
    case "LR":
      return { x: cross, y: along };
    case "RL":
      return { x: -cross, y: along };
    case "BT":
      return { x: along, y: -cross };
    default:
      return { x: along, y: cross }; // TD / TB
  }
}

/** Intersection of the segment from a box centre toward `target` with the box border. */
function borderPoint(box: LayoutBox, target: Point): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function route(
  nodes: Map<string, LayoutNode>,
  maxRank: number,
  chains: EdgeChain[],
  direction: FlowDirection,
): LayoutResult {
  const vertical = direction !== "LR" && direction !== "RL";
  const centers = rankCenters(nodes, maxRank, vertical);
  const center = new Map<string, Point>();
  const boxes = new Map<string, LayoutBox>();
  for (const node of nodes.values()) {
    const c = toScene(node.along, centers[node.rank]!, direction);
    center.set(node.id, c);
    boxes.set(node.id, { x: c.x - node.width / 2, y: c.y - node.height / 2, width: node.width, height: node.height });
  }

  const edges = new Map<number, Point[]>();
  for (const chain of chains) {
    if (chain.selfLoop) {
      const box = boxes.get(chain.nodes[0]!)!;
      const right = box.x + box.width;
      const midY = box.y + box.height / 2;
      edges.set(chain.index, [
        { x: right, y: midY - box.height / 4 },
        { x: right + SELF_LOOP, y: midY - box.height / 4 },
        { x: right + SELF_LOOP, y: midY + box.height / 4 },
        { x: right, y: midY + box.height / 4 },
      ]);
      continue;
    }
    const ids = chain.reversed ? [...chain.nodes].reverse() : chain.nodes;
    const points = ids.map((id) => ({ ...center.get(id)! }));
    points[0] = borderPoint(boxes.get(ids[0]!)!, points[1]!);
    points[points.length - 1] = borderPoint(boxes.get(ids[ids.length - 1]!)!, points[points.length - 2]!);
    edges.set(chain.index, points);
  }

  // Normalize so the whole diagram starts at (0,0).
  let minX = Infinity;
  let minY = Infinity;
  for (const box of boxes.values()) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
  }
  for (const points of edges.values()) for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  const realNodes = new Map<string, LayoutBox>();
  for (const node of nodes.values()) {
    if (node.isDummy) continue;
    const box = boxes.get(node.id)!;
    realNodes.set(node.id, { x: box.x - minX, y: box.y - minY, width: box.width, height: box.height });
  }
  for (const points of edges.values()) for (const p of points) {
    p.x -= minX;
    p.y -= minY;
  }
  return { nodes: realNodes, edges };
}
