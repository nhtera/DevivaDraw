/**
 * Which elements a frame "contains", and the helper that lets a frame drag its contents along. An
 * element belongs to a frame when its center falls inside the frame's bounds — the simple, predictable
 * rule that matches how you visually read "this shape is in that frame". Bound text, other frames, and
 * deleted elements never count as members (bound text rides its own container; nesting frames is out
 * of scope for now).
 *
 * `expandMovingIdsWithFrameChildren` is what the move gesture calls: given the ids the user is
 * dragging, it adds every contained element of any frame among them, so moving a frame moves its
 * contents as one — without those contents having to be part of the visible selection.
 */
import type { AnyElement } from "../elements/element-types";
import type { Scene } from "../scene/scene";
import { rotatedCorners } from "./selection-geometry";

function centerOf(element: AnyElement): { x: number; y: number } {
  const corners = rotatedCorners(element);
  return { x: (corners[0]!.x + corners[2]!.x) / 2, y: (corners[0]!.y + corners[2]!.y) / 2 };
}

/** Ids of the non-frame, non-bound-text, non-deleted elements whose center lies within frame `frameId`'s bounds. */
export function frameContainedElementIds(scene: Scene, frameId: string): string[] {
  const frame = scene.getElement(frameId);
  if (!frame || frame.type !== "frame") return [];
  const left = frame.x;
  const top = frame.y;
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  return scene
    .getElements()
    .filter((element) => {
      if (element.isDeleted || element.id === frameId || element.type === "frame") return false;
      if (element.type === "text" && element.containerId !== null) return false;
      const center = centerOf(element);
      return center.x >= left && center.x <= right && center.y >= top && center.y <= bottom;
    })
    .map((element) => element.id);
}

/** `movingIds` plus the contained members of every frame among them (deduped, order-stable) — the full set a drag should translate so a frame carries its contents. */
export function expandMovingIdsWithFrameChildren(scene: Scene, movingIds: readonly string[]): string[] {
  const result = new Set(movingIds);
  for (const id of movingIds) {
    const element = scene.getElement(id);
    if (element?.type === "frame") for (const childId of frameContainedElementIds(scene, id)) result.add(childId);
  }
  return [...result];
}
