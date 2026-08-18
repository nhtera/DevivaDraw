/**
 * A selection that contains a shape *and* an arrow bound to it must translate as a rigid body: the
 * regression these cover is the binding hook rerouting the not-yet-moved arrow the instant its shape
 * is written, so the subsequent `{ x, y }` write shifted geometry that had already been rewritten and
 * the arrow stretched by the drag distance (visible as the selection box changing size mid-drag).
 */
import { describe, expect, it } from "vitest";
import { bindArrowEndpoint } from "../bindings/binding-model";
import { registerArrowBindingHooks } from "../bindings/binding-scene-sync";
import { createArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "../elements/element-types";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { selectionBoundsOf } from "./selection-geometry";
import { MoveGesture } from "./selection-move-gesture";
import { SelectionState } from "./selection-state";
import type { SelectionToolDeps } from "./selection-tool-deps";
import { handleSelectionKeyDown } from "./selection-tool-keyboard";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

/** A rectangle plus an arrow whose start is bound to it, both selected — the shape is added first, so the move writes it *before* the arrow (z-order), which is the ordering that used to corrupt the arrow. */
function setup() {
  const scene = new Scene();
  registerArrowBindingHooks(scene);
  const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
  const arrow = scene.addElement(createArrowElement({ x: 104, y: 50, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }));
  bindArrowEndpoint(scene, arrow.id, "start", rect.id, { focus: 0, gap: 4 });
  const selection = new SelectionState();
  selection.selectOnly([rect.id, arrow.id]);
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const deps: SelectionToolDeps = { scene, selection, history, clipboard: new InternalClipboard(), getZoom: () => 1 };
  return { scene, selection, rect, arrow, deps };
}

function arrowSpan(scene: Scene, id: string): { x: number; y: number; length: number } {
  const arrow = scene.getElement(id);
  if (arrow?.type !== "arrow") throw new Error("not an arrow");
  const first = arrow.points[0]!;
  const last = arrow.points[arrow.points.length - 1]!;
  return { x: arrow.x, y: arrow.y, length: Math.hypot(last.x - first.x, last.y - first.y) };
}

describe("moving a shape together with an arrow bound to it", () => {
  it("translates the arrow without restretching it, and keeps the selection the same size", () => {
    const { scene, rect, arrow, deps } = setup();
    const before = arrowSpan(scene, arrow.id);
    const boundsBefore = selectionBoundsOf([scene.getElement(rect.id)!, scene.getElement(arrow.id)!])!;

    const move = new MoveGesture(deps);
    expect(move.begin({ x: 5, y: 5 }, rect.id, NO_MODIFIERS)).toBe(true);
    move.apply({ x: 105, y: 45 }, NO_MODIFIERS); // dx = 100, dy = 40
    move.finish();

    const after = arrowSpan(scene, arrow.id);
    expect(after.x).toBeCloseTo(before.x + 100);
    expect(after.y).toBeCloseTo(before.y + 40);
    expect(after.length).toBeCloseTo(before.length);
    expect(scene.getElement(rect.id)).toMatchObject({ x: 100, y: 40 });

    const boundsAfter = selectionBoundsOf([scene.getElement(rect.id)!, scene.getElement(arrow.id)!])!;
    expect(boundsAfter.width).toBeCloseTo(boundsBefore.width);
    expect(boundsAfter.height).toBeCloseTo(boundsBefore.height);
  });

  it("keeps the arrow rigid across the many intermediate frames of one drag", () => {
    const { scene, rect, arrow, deps } = setup();
    const before = arrowSpan(scene, arrow.id);

    const move = new MoveGesture(deps);
    move.begin({ x: 5, y: 5 }, rect.id, NO_MODIFIERS);
    for (let step = 1; step <= 20; step += 1) {
      move.apply({ x: 5 + step * 3, y: 5 + step }, NO_MODIFIERS);
      expect(arrowSpan(scene, arrow.id).length).toBeCloseTo(before.length);
    }
    move.finish();

    expect(arrowSpan(scene, arrow.id).x).toBeCloseTo(before.x + 60);
  });

  it("nudges the pair by the keyboard step without restretching the arrow", () => {
    const { scene, arrow, deps } = setup();
    const before = arrowSpan(scene, arrow.id);

    handleSelectionKeyDown(deps, "ArrowRight", { ...NO_MODIFIERS, shift: true }); // coarse step

    const after = arrowSpan(scene, arrow.id);
    expect(after.x).toBeCloseTo(before.x + 10);
    expect(after.length).toBeCloseTo(before.length);
  });
});
