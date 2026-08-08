import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { createCamera } from "./camera";
import type { InteractiveLayerContext, OverlayState } from "./interactive-layer";
import { InteractiveLayer } from "./interactive-layer";

function fakeContext(width = 800, height = 600): InteractiveLayerContext {
  return {
    canvas: { clientWidth: width, clientHeight: height },
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
  };
}

function stored<T extends object>(element: T): T & { version: number; versionNonce: number; updated: number; index: string } {
  return { ...element, version: 1, versionNonce: 1, updated: 1, index: "a" };
}

const EMPTY_OVERLAY: OverlayState = { selectedElements: [], marqueeRect: null, snapGuides: [] };

describe("InteractiveLayer.render", () => {
  it("always clears the canvas first", () => {
    const ctx = fakeContext();
    new InteractiveLayer(ctx).render(EMPTY_OVERLAY, createCamera());
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it("draws nothing else with an empty overlay", () => {
    const ctx = fakeContext();
    new InteractiveLayer(ctx).render(EMPTY_OVERLAY, createCamera());
    expect(ctx.strokeRect).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("draws the marquee rect (both fill and stroke)", () => {
    const ctx = fakeContext();
    const overlay: OverlayState = { ...EMPTY_OVERLAY, marqueeRect: { x: 0, y: 0, width: 50, height: 50 } };
    new InteractiveLayer(ctx).render(overlay, createCamera());
    expect(ctx.fillRect).toHaveBeenCalledTimes(1); // marquee only — no selection in this overlay
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("draws a dashed line per snap guide", () => {
    const ctx = fakeContext();
    const overlay: OverlayState = {
      ...EMPTY_OVERLAY,
      snapGuides: [{ orientation: "vertical", position: 10, from: 0, to: 100 }],
    };
    new InteractiveLayer(ctx).render(overlay, createCamera());
    expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it("draws the selection outline and all 8 resize handles + the rotate handle for a selected element", () => {
    const ctx = fakeContext();
    const rect = stored(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const overlay: OverlayState = { ...EMPTY_OVERLAY, selectedElements: [rect] };
    new InteractiveLayer(ctx).render(overlay, createCamera());

    expect(ctx.closePath).toHaveBeenCalledTimes(1); // outline path closed
    // 9 handle squares (8 resize + 1 rotate), each drawn via fillRect + strokeRect.
    expect(ctx.fillRect).toHaveBeenCalledTimes(9);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(9);
  });

  it("draws one unified axis-aligned frame for a multi-element selection", () => {
    const ctx = fakeContext();
    const a = stored(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const b = stored(createRectangleElement({ x: 50, y: 0, width: 10, height: 10 }));
    const overlay: OverlayState = { ...EMPTY_OVERLAY, selectedElements: [a, b] };
    new InteractiveLayer(ctx).render(overlay, createCamera());
    expect(ctx.fillRect).toHaveBeenCalledTimes(9);
  });
});

describe("InteractiveLayer.render — remote cursors", () => {
  it("draws nothing when remoteCursors is omitted (existing, non-collab hosts unaffected)", () => {
    const ctx = fakeContext();
    new InteractiveLayer(ctx).render(EMPTY_OVERLAY, createCamera());
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it("draws a filled pointer marker per remote cursor", () => {
    const ctx = fakeContext();
    const overlay: OverlayState = {
      ...EMPTY_OVERLAY,
      remoteCursors: [
        { id: "peer-1", name: "Alice", color: "#ff0000", point: { x: 10, y: 20 } },
        { id: "peer-2", name: "Bob", color: "#00ff00", point: { x: 30, y: 40 } },
      ],
    };
    new InteractiveLayer(ctx).render(overlay, createCamera());
    expect(ctx.fill).toHaveBeenCalledTimes(2);
    expect(ctx.closePath).toHaveBeenCalledTimes(2);
  });

  it("skips the name-tag label on a context that doesn't implement fillText, without throwing", () => {
    const ctx = fakeContext();
    expect(ctx.fillText).toBeUndefined();
    const overlay: OverlayState = { ...EMPTY_OVERLAY, remoteCursors: [{ id: "peer-1", name: "Alice", color: "#ff0000", point: { x: 0, y: 0 } }] };
    expect(() => new InteractiveLayer(ctx).render(overlay, createCamera())).not.toThrow();
  });

  it("calls fillText with the cursor's name when the context supports it", () => {
    const ctx = { ...fakeContext(), fillText: vi.fn() };
    const overlay: OverlayState = { ...EMPTY_OVERLAY, remoteCursors: [{ id: "peer-1", name: "Alice", color: "#ff0000", point: { x: 0, y: 0 } }] };
    new InteractiveLayer(ctx).render(overlay, createCamera());
    expect(ctx.fillText).toHaveBeenCalledWith("Alice", expect.any(Number), expect.any(Number));
  });

  it("draws an empty remoteCursors array as nothing", () => {
    const ctx = fakeContext();
    const overlay: OverlayState = { ...EMPTY_OVERLAY, remoteCursors: [] };
    new InteractiveLayer(ctx).render(overlay, createCamera());
    expect(ctx.fill).not.toHaveBeenCalled();
  });
});
