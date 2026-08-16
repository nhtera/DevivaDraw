import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { ResizeGesture } from "./selection-resize-gesture";
import { rotatePointAroundCenter } from "./selection-geometry";
import { SelectionState } from "./selection-state";
import { handlePositions } from "./resize-handles";
import { buildSelectionFrame } from "./selection-tool-frame";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function setup() {
  const scene = new Scene();
  const selection = new SelectionState();
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const clipboard = new InternalClipboard();
  const gesture = new ResizeGesture({ scene, selection, history, clipboard, getZoom: () => 1 });
  return { scene, gesture };
}

/** World position the renderer would place local `point` at for `bounds`/`angle` — mirrors `render/text-renderer.ts`'s own "rotate around own center" rule. */
function worldPositionOf(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }, angle: number) {
  return rotatePointAroundCenter(point, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, angle);
}

/**
 * World point of `handle`'s exact position on `frame` — the grab point for a pointer-down that lands
 * dead-centre on the handle, so `begin` records a zero grab offset and the pointer maps straight onto
 * the geometry (what every assertion in this file is written against). A real click lands a few px off
 * and the gesture holds that offset; that behavior is covered in `selection-tool-transforms.test.ts`.
 */
function grabPointFor(frame: ReturnType<typeof buildSelectionFrame>, handle: "se" | "nw") {
  return rotatePointAroundCenter(handlePositions(frame!.bounds)[handle], frame!.pivot, frame!.angle);
}

describe("ResizeGesture — rotated single-element anchor invariance", () => {
  it.each([Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4, -Math.PI / 3])(
    "keeps the se handle's opposite (nw) corner world-fixed when resizing at angle %f",
    (angle) => {
      const { scene, gesture } = setup();
      const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50, angle }));
      const frame = buildSelectionFrame([rect])!;
      const worldAnchorBefore = worldPositionOf({ x: 0, y: 0 }, frame.bounds, angle);

      gesture.begin(frame, "se", grabPointFor(frame, "se"));
      // A pointer drag to local (150, 80) is expressed as a *world* point (the gesture rotates it
      // back into local space itself) by rotating the intended local target the same way the element
      // is rotated — this reproduces exactly what a real rotated on-screen drag looks like.
      const worldTarget = rotatePointAroundCenter({ x: 150, y: 80 }, frame.pivot, angle);
      gesture.apply(worldTarget, NO_MODIFIERS);

      const resized = scene.getElement(rect.id)!;
      // For an `se` drag the anchor (nw corner) is always exactly the resized box's own (x, y).
      const worldAnchorAfter = worldPositionOf({ x: resized.x, y: resized.y }, resized, resized.angle);
      expect(worldAnchorAfter.x).toBeCloseTo(worldAnchorBefore.x, 5);
      expect(worldAnchorAfter.y).toBeCloseTo(worldAnchorBefore.y, 5);
      expect(resized.width).toBeGreaterThan(0);
      expect(resized.height).toBeGreaterThan(0);
    },
  );

  it("keeps the nw handle's opposite (se) corner world-fixed too — not just the se-handle case", () => {
    const angle = Math.PI / 3;
    const { scene, gesture } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50, angle }));
    const frame = buildSelectionFrame([rect])!;
    const worldAnchorBefore = worldPositionOf({ x: 100, y: 50 }, frame.bounds, angle); // se corner

    gesture.begin(frame, "nw", grabPointFor(frame, "nw"));
    const worldTarget = rotatePointAroundCenter({ x: -20, y: -10 }, frame.pivot, angle);
    gesture.apply(worldTarget, NO_MODIFIERS);

    const resized = scene.getElement(rect.id)!;
    const seCornerLocal = { x: resized.x + resized.width, y: resized.y + resized.height };
    const worldAnchorAfter = worldPositionOf(seCornerLocal, resized, resized.angle);
    expect(worldAnchorAfter.x).toBeCloseTo(worldAnchorBefore.x, 5);
    expect(worldAnchorAfter.y).toBeCloseTo(worldAnchorBefore.y, 5);
  });

  it("unrotated (angle=0) resize is unaffected by the compensation — behaves exactly as before", () => {
    const { scene, gesture } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const frame = buildSelectionFrame([rect])!;
    gesture.begin(frame, "se", grabPointFor(frame, "se"));
    gesture.apply({ x: 150, y: 80 }, NO_MODIFIERS);
    expect(scene.getElement(rect.id)).toMatchObject({ x: 0, y: 0, width: 150, height: 80 });
  });

  it("alt (from-center) resize needs no compensation — the center is already the invariant point", () => {
    const angle = Math.PI / 2;
    const { scene, gesture } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50, angle }));
    const frame = buildSelectionFrame([rect])!;
    const centerBefore = frame.pivot;

    gesture.begin(frame, "se", grabPointFor(frame, "se"));
    const worldTarget = rotatePointAroundCenter({ x: 150, y: 80 }, frame.pivot, angle);
    gesture.apply(worldTarget, { ...NO_MODIFIERS, alt: true });

    const resized = scene.getElement(rect.id)!;
    const centerAfter = { x: resized.x + resized.width / 2, y: resized.y + resized.height / 2 };
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 5);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 5);
  });
});

describe("ResizeGesture — multi-element selection with a rotated member", () => {
  it("scales a rotated member's bbox proportionally without touching its own angle (frame itself stays axis-aligned)", () => {
    const { scene, gesture } = setup();
    const rotatedMember = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, angle: Math.PI / 4 }));
    const plainMember = scene.addElement(createRectangleElement({ x: 100, y: 0, width: 20, height: 20 }));
    const frame = buildSelectionFrame([rotatedMember, plainMember])!;
    expect(frame.angle).toBe(0); // a multi-select frame is always axis-aligned, regardless of member rotation

    gesture.begin(frame, "se", grabPointFor(frame, "se"));
    gesture.apply({ x: frame.bounds.x + frame.bounds.width * 2, y: frame.bounds.y + frame.bounds.height * 2 }, NO_MODIFIERS);

    const resized = scene.getElement(rotatedMember.id)!;
    expect(resized.angle).toBeCloseTo(Math.PI / 4, 5); // its own rotation is untouched by the group resize
    expect(Number.isFinite(resized.x)).toBe(true);
    expect(Number.isFinite(resized.y)).toBe(true);
    expect(resized.width).toBeGreaterThan(20); // the group grew, so did this member's bbox
    expect(resized.height).toBeGreaterThan(20);
  });
});

describe("ResizeGesture — table row re-fit at finish", () => {
  it("re-fits a resized table's rows to its wrapped text inside the same history batch", async () => {
    const { createTableElement } = await import("../elements/table-element");
    const { MIN_ROW_HEIGHT, TABLE_CELL_PADDING } = await import("../elements/table-layout");
    const { createFixedWidthTextMeasurer } = await import("../text/text-measurement");

    const scene = new Scene();
    // One row, tall enough for its text at full width (200): wrap width 188 → 18 chars/line.
    const table = scene.addElement(
      createTableElement({ x: 0, y: 0, columnWidths: [200], rowHeights: [40], cells: [["a".repeat(36)]], fontSize: 20 }),
    );
    // History baseline captured AFTER creation (the runtime pushes a snapshot per committed change),
    // so one undo lands on the pre-resize table, not an empty scene.
    const history = new HistoryStack<AnyElement[]>(scene.getElements());
    const gesture = new ResizeGesture({
      scene,
      selection: new SelectionState(),
      history,
      clipboard: new InternalClipboard(),
      getZoom: () => 1,
      textMeasurer: createFixedWidthTextMeasurer(10),
    });
    const frame = buildSelectionFrame([table])!;

    gesture.begin(frame, "se", grabPointFor(frame, "se"));
    gesture.apply({ x: 100, y: 40 }, NO_MODIFIERS); // halve the width; per-frame path never measures text
    gesture.finish();

    const resized = scene.getElement(table.id)!;
    expect(resized.type).toBe("table");
    if (resized.type !== "table") return;
    // Wrap width now 100 - 2*padding = 88 → 8 chars/line → 36 chars = 5 lines * 25px + padding*2.
    expect(resized.rowHeights[0]).toBe(5 * 25 + TABLE_CELL_PADDING * 2);
    expect(resized.rowHeights[0]!).toBeGreaterThan(MIN_ROW_HEIGHT);
    expect(resized.height).toBe(resized.rowHeights[0]);

    // Resize + re-fit are ONE undo step: a single undo restores the original 200-wide, 40-tall grid.
    const undone = history.undo();
    expect(undone).toBeDefined();
    scene.loadElementsSnapshot(undone!);
    const restored = scene.getElement(table.id);
    expect(restored?.type).toBe("table");
    const restoredTable = restored as import("../elements/table-element").TableElement;
    expect(restoredTable.columnWidths).toEqual([200]);
    expect(restoredTable.rowHeights).toEqual([40]);
  });
});
