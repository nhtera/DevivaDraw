/**
 * Keyboard flowcharting: from a selected bindable shape, spawn a same-shaped empty node a fixed gap
 * away in a direction and connect the two with an arrow bound at the facing edge midpoints — the
 * "Alt+Arrow grows the diagram" flow that turns box-arrow-box diagramming into keystrokes.
 *
 * The clone copies the source's geometry and style but never its label, group, frame, or link — a
 * spawned node is a fresh sibling, not a duplicate. Both arrow endpoints bind with `fixedPoint`
 * (edge midpoints), so the standard reroute hooks keep the connector attached as either node moves.
 */
import type { AnyElement } from "../elements/element-types";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { createArrowElement } from "../elements/arrow-element";
import { isBindableContainer } from "../text/bound-text";
import { bindArrowEndpoint } from "./binding-model";
import { insertElements } from "../selection/clipboard";

export type FlowSpawnDirection = "up" | "down" | "left" | "right";

/** Scene-unit gap between the two facing edges — matches the spacing the layout of a typical hand-drawn flowchart settles on. */
export const FLOW_NODE_GAP = 96;

const DIRECTION_VECTORS: Record<FlowSpawnDirection, { dx: number; dy: number; sourceAnchor: [number, number]; targetAnchor: [number, number] }> = {
  right: { dx: 1, dy: 0, sourceAnchor: [1, 0.5], targetAnchor: [0, 0.5] },
  left: { dx: -1, dy: 0, sourceAnchor: [0, 0.5], targetAnchor: [1, 0.5] },
  down: { dx: 0, dy: 1, sourceAnchor: [0.5, 1], targetAnchor: [0.5, 0] },
  up: { dx: 0, dy: -1, sourceAnchor: [0.5, 0], targetAnchor: [0.5, 1] },
};

/**
 * Spawns the node + connecting arrow; returns the new node's id (select it, so the next press chains),
 * or `null` when `sourceId` isn't a live bindable shape. One scene mutation burst — callers wrap it
 * in a history batch.
 */
export function spawnConnectedNode(scene: Scene, sourceId: string, direction: FlowSpawnDirection): string | null {
  const source = scene.getElement(sourceId);
  if (!source || source.isDeleted || !isBindableContainer(source)) return null;

  const vector = DIRECTION_VECTORS[direction];
  const offset = {
    dx: vector.dx * (source.width + FLOW_NODE_GAP),
    dy: vector.dy * (source.height + FLOW_NODE_GAP),
  };
  // A bare geometric/style clone — `insertElements` re-stamps identity (fresh id/version/index).
  const bareClone: AnyElement = { ...source, boundElements: [], groupIds: [], frameId: null, link: null };
  const [nodeId] = insertElements(scene, [bareClone], offset);
  if (nodeId === undefined) return null;

  const startPoint: Point = {
    x: source.x + vector.sourceAnchor[0] * source.width,
    y: source.y + vector.sourceAnchor[1] * source.height,
  };
  const endPoint: Point = { x: startPoint.x + offset.dx - vector.dx * source.width, y: startPoint.y + offset.dy - vector.dy * source.height };
  // The initial points only need to be sane: binding with `fixedPoint` below hands the exact
  // endpoint geometry (edge midpoint + gap) to the standard reroute hooks.
  const arrow = scene.addElement(
    createArrowElement({
      x: Math.min(startPoint.x, endPoint.x),
      y: Math.min(startPoint.y, endPoint.y),
      width: Math.abs(endPoint.x - startPoint.x),
      height: Math.abs(endPoint.y - startPoint.y),
      points: [
        { x: 0, y: 0 },
        { x: endPoint.x - startPoint.x, y: endPoint.y - startPoint.y },
      ],
      strokeColor: source.strokeColor,
      opacity: source.opacity,
    }),
  );
  bindArrowEndpoint(scene, arrow.id, "start", source.id, { focus: 0, gap: 4, fixedPoint: vector.sourceAnchor });
  bindArrowEndpoint(scene, arrow.id, "end", nodeId, { focus: 0, gap: 4, fixedPoint: vector.targetAnchor });
  return nodeId;
}
