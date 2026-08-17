/**
 * Rotate-gesture state machine: freezes the selection frame's pivot at gesture start, then re-derives
 * the rotation delta on every move from the pointer's bearing change relative to that pivot
 * (`resize-handles.ts`'s `computeRotationDelta`) and applies it to every member via
 * `group-transform.ts`'s `rotateElementsAroundPivot`. See `selection-tool.ts`'s module doc.
 */
import type { AnyElement } from "../elements/element-types";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import { rotateElementsAroundPivot } from "./group-transform";
import { computeRotationDelta } from "./resize-handles";
import type { SelectionToolDeps } from "./selection-tool-deps";
import type { SelectionFrame } from "./selection-tool-frame";

const MIN_MEANINGFUL_ROTATION_RADIANS = 1e-6;

export class RotateGesture {
  private readonly deps: SelectionToolDeps;
  private frame: SelectionFrame | null = null;
  private startPoint: Point | null = null;
  private originalElements: Map<string, AnyElement> | null = null;
  private lastDelta = 0;

  constructor(deps: SelectionToolDeps) {
    this.deps = deps;
  }

  begin(point: Point, frame: SelectionFrame): void {
    this.frame = frame;
    this.startPoint = point;
    this.lastDelta = 0;
    this.deps.history.beginBatch();
    this.originalElements = new Map(frame.members.map((member) => [member.id, this.deps.scene.getElement(member.id)!]));
  }

  apply(point: Point, modifiers: ModifierKeys): void {
    if (!this.frame || !this.startPoint) return;
    const delta = computeRotationDelta(this.frame.pivot, this.startPoint, point, modifiers.shift);
    this.lastDelta = delta;
    const frame = this.frame;
    // Batched for the same reason as the move gesture: one dispatch per frame, not per element.
    this.deps.scene.batch(() => {
      for (const result of rotateElementsAroundPivot(frame.members, frame.pivot, delta)) {
        this.deps.scene.updateElement(result.id, result.changes);
      }
    });
  }

  finish(): void {
    if (Math.abs(this.lastDelta) < MIN_MEANINGFUL_ROTATION_RADIANS) this.deps.history.cancelBatch();
    else this.deps.history.endBatch(this.deps.scene.getElements());
    this.reset();
  }

  cancel(): void {
    if (this.originalElements) {
      const originals = this.originalElements;
      this.deps.scene.batch(() => {
        for (const original of originals.values()) this.deps.scene.updateElement(original.id, original);
      });
    }
    this.reset();
  }

  private reset(): void {
    this.frame = null;
    this.startPoint = null;
    this.originalElements = null;
    this.lastDelta = 0;
  }
}
