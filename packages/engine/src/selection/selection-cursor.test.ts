import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { resizeCursorForHandle, selectionHoverCursor } from "./selection-cursor";

describe("resizeCursorForHandle", () => {
  it("maps the unrotated handles to their axis cursors", () => {
    expect(resizeCursorForHandle("e", 0)).toBe("ew-resize");
    expect(resizeCursorForHandle("w", 0)).toBe("ew-resize");
    expect(resizeCursorForHandle("n", 0)).toBe("ns-resize");
    expect(resizeCursorForHandle("s", 0)).toBe("ns-resize");
    expect(resizeCursorForHandle("se", 0)).toBe("nwse-resize");
    expect(resizeCursorForHandle("nw", 0)).toBe("nwse-resize");
    expect(resizeCursorForHandle("ne", 0)).toBe("nesw-resize");
    expect(resizeCursorForHandle("sw", 0)).toBe("nesw-resize");
  });

  it("rotates the cursor with the frame", () => {
    expect(resizeCursorForHandle("e", Math.PI / 2)).toBe("ns-resize"); // quarter turn: east edge now vertical
    expect(resizeCursorForHandle("se", Math.PI / 2)).toBe("nesw-resize");
    expect(resizeCursorForHandle("e", Math.PI / 4)).toBe("nwse-resize");
  });

  it("quantizes near-axis angles to the nearest cursor rather than jumping early", () => {
    expect(resizeCursorForHandle("e", (10 * Math.PI) / 180)).toBe("ew-resize");
    expect(resizeCursorForHandle("e", (35 * Math.PI) / 180)).toBe("nwse-resize");
  });
});

describe("selectionHoverCursor", () => {
  // 100x80 box at (100,100); unfilled, so unselected hits are stroke-only (same rule as clicking).
  const rect = createRectangleElement({ x: 100, y: 100, width: 100, height: 80 });
  const scene = new Scene();
  scene.addElement(rect);

  it("shows move over an element's geometry and default over empty canvas", () => {
    expect(selectionHoverCursor(scene, [], { x: 100, y: 140 }, 1)).toBe("move"); // on the stroke
    expect(selectionHoverCursor(scene, [], { x: 150, y: 140 }, 1)).toBe("default"); // unfilled interior, not selected
    expect(selectionHoverCursor(scene, [], { x: 500, y: 500 }, 1)).toBe("default");
  });

  it("shows move anywhere inside the selection frame once selected", () => {
    expect(selectionHoverCursor(scene, [rect], { x: 150, y: 140 }, 1)).toBe("move");
  });

  it("shows the direction cursor over a resize handle and grab over the rotate handle", () => {
    // Selection bounds inflate by 6 screen px, so the se corner handle sits at (206, 186)
    // and the rotate handle floats 28px above the inflated top-center: (150, 66).
    expect(selectionHoverCursor(scene, [rect], { x: 206, y: 186 }, 1)).toBe("nwse-resize");
    expect(selectionHoverCursor(scene, [rect], { x: 150, y: 66 }, 1)).toBe("grab");
  });

  it("rotates the resize cursor with a rotated element's frame", () => {
    // The same box a quarter-turn rotated: its east handle's world position swings below the pivot,
    // and the cursor there must be vertical, not horizontal.
    const rotated = { ...rect, id: "rotated", angle: Math.PI / 2 };
    const rotatedScene = new Scene();
    rotatedScene.addElement(rotated);
    expect(selectionHoverCursor(rotatedScene, [rotated], { x: 150, y: 196 }, 1)).toBe("ns-resize");
  });
});
