import { describe, expect, it } from "vitest";
import { createCamera } from "../render/camera";
import type { Camera } from "../render/camera";
import { PanZoomTool } from "./pan-zoom-tool";
import type { PanZoomToolDeps } from "./pan-zoom-tool";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function buildDeps(initial: Camera = createCamera()): PanZoomToolDeps & { camera: Camera } {
  const state = { camera: initial };
  return {
    get camera() {
      return state.camera;
    },
    getCamera: () => state.camera,
    setCamera: (camera) => {
      state.camera = camera;
    },
    getViewportSize: () => ({ width: 800, height: 600 }),
    getSceneBounds: () => null,
  };
}

describe("PanZoomTool drag-pan gesture", () => {
  it("does nothing on move/end before a gesture has started", () => {
    const deps = buildDeps();
    const tool = new PanZoomTool(deps);
    tool.onGestureMove({ x: 5, y: 5 }, NO_MODIFIERS);
    expect(deps.camera).toEqual(createCamera());
  });

  it("pans by the exact scene-space delta between start and a single move (frozen-camera points)", () => {
    const deps = buildDeps(createCamera({ zoom: 2 }));
    const tool = new PanZoomTool(deps);

    tool.onGestureStart({ x: 100, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 90, y: 60 }, NO_MODIFIERS); // moved -10 in x, +10 in y (scene units)

    // Cursor moving left/down in the gesture's scene frame pans the camera the same direction it
    // moved (grab-and-drag: whatever was under the cursor stays under the cursor), matching
    // `sceneToScreen`'s `(scene + scroll) * zoom` sign convention.
    expect(deps.camera.scrollX).toBeCloseTo(-10, 9);
    expect(deps.camera.scrollY).toBeCloseTo(10, 9);
    expect(deps.camera.zoom).toBe(2);
  });

  it("accumulates correctly across multiple move events in the same frozen coordinate frame", () => {
    const deps = buildDeps();
    const tool = new PanZoomTool(deps);

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 10, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 25, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 40, y: 0 }, NO_MODIFIERS);

    // Total scene-space movement was 40 in x; camera should have panned by the same amount.
    expect(deps.camera.scrollX).toBeCloseTo(40, 9);
  });

  it("onGestureCancel discards drag state without touching the camera further", () => {
    const deps = buildDeps();
    const tool = new PanZoomTool(deps);

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 10, y: 0 }, NO_MODIFIERS);
    const cameraAfterMove = deps.camera;
    tool.onGestureCancel(NO_MODIFIERS);
    expect(deps.camera).toBe(cameraAfterMove); // cancel itself applies no further mutation

    // A subsequent move without a new start is now a no-op (drag state was cleared).
    tool.onGestureMove({ x: 999, y: 999 }, NO_MODIFIERS);
    expect(deps.camera).toBe(cameraAfterMove);
  });
});

describe("PanZoomTool.panByScreenDelta", () => {
  it("pans the live camera directly, independent of any gesture", () => {
    const deps = buildDeps(createCamera({ zoom: 2 }));
    const tool = new PanZoomTool(deps);
    tool.panByScreenDelta(100, -40);
    expect(deps.camera).toEqual({ scrollX: -50, scrollY: 20, zoom: 2 });
  });
});

describe("PanZoomTool.zoomByWheelDelta", () => {
  it("zooms in on negative deltaY (wheel-up) and keeps the anchor screen point fixed", () => {
    const deps = buildDeps();
    const tool = new PanZoomTool(deps);
    tool.zoomByWheelDelta({ x: 400, y: 300 }, -100);
    expect(deps.camera.zoom).toBeGreaterThan(1);
  });

  it("zooms out on positive deltaY (wheel-down)", () => {
    const deps = buildDeps();
    const tool = new PanZoomTool(deps);
    tool.zoomByWheelDelta({ x: 400, y: 300 }, 100);
    expect(deps.camera.zoom).toBeLessThan(1);
  });
});

describe("PanZoomTool.zoomStep", () => {
  it("steps zoom up centered on the viewport center", () => {
    const deps = buildDeps();
    const tool = new PanZoomTool(deps);
    tool.zoomStep(1);
    expect(deps.camera.zoom).toBeCloseTo(1.1, 9);
  });

  it("steps zoom down", () => {
    const deps = buildDeps();
    const tool = new PanZoomTool(deps);
    tool.zoomStep(-1);
    expect(deps.camera.zoom).toBeCloseTo(1 / 1.1, 9);
  });
});

describe("PanZoomTool.zoomToFit", () => {
  it("no-ops when there is nothing to fit", () => {
    const deps = buildDeps();
    const tool = new PanZoomTool(deps);
    const before = deps.camera;
    tool.zoomToFit();
    expect(deps.camera).toBe(before);
  });

  it("fits the reported scene bounds when present", () => {
    const state = { camera: createCamera() };
    const deps: PanZoomToolDeps = {
      getCamera: () => state.camera,
      setCamera: (camera) => {
        state.camera = camera;
      },
      getViewportSize: () => ({ width: 1000, height: 800 }),
      getSceneBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    };
    const tool = new PanZoomTool(deps);
    tool.zoomToFit();
    expect(state.camera.zoom).toBeGreaterThan(1); // a small 100x100 box fills most of a 1000x800 viewport
  });
});

describe("PanZoomTool revealRect (find-on-canvas)", () => {
  it("centers a small rect in the viewport, keeping the current zoom", () => {
    const deps = buildDeps(createCamera({ zoom: 2 })); // 800x600 viewport
    const tool = new PanZoomTool(deps);

    tool.revealRect({ x: 100, y: 100, width: 20, height: 10 });

    // Rect center (110, 105) must land at the viewport center (400, 300) in screen space:
    // (center + scroll) * zoom === viewportCenter.
    expect((110 + deps.camera.scrollX) * deps.camera.zoom).toBeCloseTo(400, 6);
    expect((105 + deps.camera.scrollY) * deps.camera.zoom).toBeCloseTo(300, 6);
    expect(deps.camera.zoom).toBe(2); // small rect fits at current zoom → zoom unchanged
  });

  it("zooms out (never in) to fit a rect larger than the viewport", () => {
    const deps = buildDeps(createCamera({ zoom: 4 })); // 800x600 viewport
    const tool = new PanZoomTool(deps);

    tool.revealRect({ x: 0, y: 0, width: 4000, height: 3000 });

    expect(deps.camera.zoom).toBeLessThan(4); // reduced to fit
  });

  it("no-ops on a zero-area rect", () => {
    const deps = buildDeps();
    const before = deps.camera;
    const tool = new PanZoomTool(deps);
    tool.revealRect({ x: 5, y: 5, width: 0, height: 0 });
    expect(deps.camera).toBe(before);
  });
});
