import rough from "roughjs";
import { describe, expect, it, vi } from "vitest";
import { createDiamondElement, createEllipseElement, createLineElement, createRectangleElement } from "../elements/shape-elements";
import { createGenericElement } from "../elements/element-types";
import { createCamera } from "./camera";
import type { RoughDrawContext2D } from "./rough-renderer";
import { buildElementDrawable, drawElementRough } from "./rough-renderer";

/**
 * `rough.generator()` is headless — no canvas/DOM required — which is exactly why
 * `buildElementDrawable` accepts any `RoughShapeDrawer`, not just a canvas-bound `RoughCanvas`: it
 * lets the "pure op generation" half of the rough.js dispatch run in plain node/vitest.
 */
const generator = rough.generator();

function fakeCtx(): RoughDrawContext2D {
  return { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    scale: vi.fn(), globalAlpha: 1 };
}

describe("buildElementDrawable — determinism", () => {
  it("produces byte-identical ops for the same element/seed across two calls (no re-roll on redraw)", () => {
    const element = createRectangleElement({ x: 10, y: 10, width: 100, height: 60, seed: 777 });
    const camera = createCamera();

    const first = buildElementDrawable(generator, element, camera);
    const second = buildElementDrawable(generator, element, camera);

    expect(first).not.toBeNull();
    expect(first?.sets).toEqual(second?.sets);
  });

  it("produces different ops for two elements that differ only by seed", () => {
    const a = createRectangleElement({ x: 0, y: 0, width: 100, height: 60, seed: 1 });
    const b = createRectangleElement({ x: 0, y: 0, width: 100, height: 60, seed: 2 });
    const camera = createCamera();

    const drawableA = buildElementDrawable(generator, a, camera);
    const drawableB = buildElementDrawable(generator, b, camera);

    expect(drawableA?.sets).not.toEqual(drawableB?.sets);
  });

  it("returns null for a zero-size element instead of generating degenerate ops", () => {
    const element = createRectangleElement({ x: 0, y: 0, width: 0, height: 0 });
    expect(buildElementDrawable(generator, element, createCamera())).toBeNull();
  });
});

describe("buildElementDrawable — per-shape-type dispatch", () => {
  it("dispatches rectangle via the plain rectangle path (no rounding) when roundness is null", () => {
    const element = createRectangleElement({ x: 0, y: 0, width: 40, height: 20, seed: 1, roundness: null });
    const drawable = buildElementDrawable(generator, element, createCamera());
    expect(drawable?.shape).toBe("rectangle");
  });

  it("dispatches a rounded rectangle via the path generator when roundness.type is the round-corner type", () => {
    const element = createRectangleElement({ x: 0, y: 0, width: 40, height: 20, seed: 1, roundness: { type: 1 } });
    const drawable = buildElementDrawable(generator, element, createCamera());
    expect(drawable?.shape).toBe("path");
  });

  it("dispatches ellipse and diamond via their respective generators", () => {
    const ellipse = createEllipseElement({ x: 0, y: 0, width: 40, height: 20, seed: 1 });
    expect(buildElementDrawable(generator, ellipse, createCamera())?.shape).toBe("ellipse");

    const diamond = createDiamondElement({ x: 0, y: 0, width: 40, height: 20, seed: 1 });
    expect(buildElementDrawable(generator, diamond, createCamera())?.shape).toBe("polygon");
  });

  it("dispatches an open polyline via linearPath and a closed one via polygon", () => {
    const open = createLineElement({
      x: 0,
      y: 0,
      seed: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    expect(buildElementDrawable(generator, open, createCamera())?.shape).toBe("linearPath");

    const closed = createLineElement({
      x: 0,
      y: 0,
      seed: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
      ],
    });
    expect(buildElementDrawable(generator, closed, createCamera())?.shape).toBe("polygon");
  });

  it("renders the legacy generic element type as a plain rectangle rather than throwing", () => {
    const element = createGenericElement({ x: 0, y: 0, width: 10, height: 10 });
    expect(buildElementDrawable(generator, element, createCamera())?.shape).toBe("rectangle");
  });

  it("returns null for a line with fewer than 2 points", () => {
    const element = createLineElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }] });
    expect(buildElementDrawable(generator, element, createCamera())).toBeNull();
  });
});

describe("drawElementRough", () => {
  it("wraps the draw call in save/restore and sets globalAlpha from the element's opacity", () => {
    const ctx = fakeCtx();
    const roughCanvas = { rectangle: vi.fn(), ellipse: vi.fn(), polygon: vi.fn(), linearPath: vi.fn(), path: vi.fn(), draw: vi.fn() };
    const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10, opacity: 50 });

    drawElementRough(ctx, roughCanvas, element, createCamera());

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(ctx.globalAlpha).toBe(0.5);
    expect(roughCanvas.rectangle).toHaveBeenCalledTimes(1);
  });

  it("applies a rotate transform around the element's screen-space center when angle is non-zero", () => {
    const ctx = fakeCtx();
    const roughCanvas = { rectangle: vi.fn(), ellipse: vi.fn(), polygon: vi.fn(), linearPath: vi.fn(), path: vi.fn(), draw: vi.fn() };
    const element = createRectangleElement({ x: 0, y: 0, width: 20, height: 20, angle: Math.PI / 4 });

    drawElementRough(ctx, roughCanvas, element, createCamera());

    expect(ctx.translate).toHaveBeenCalledWith(10, 10);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 4);
    expect(ctx.translate).toHaveBeenCalledWith(-10, -10);
  });

  it("skips the rotate transform entirely when angle is 0", () => {
    const ctx = fakeCtx();
    const roughCanvas = { rectangle: vi.fn(), ellipse: vi.fn(), polygon: vi.fn(), linearPath: vi.fn(), path: vi.fn(), draw: vi.fn() };
    const element = createRectangleElement({ x: 0, y: 0, width: 20, height: 20, angle: 0 });

    drawElementRough(ctx, roughCanvas, element, createCamera());

    expect(ctx.rotate).not.toHaveBeenCalled();
  });
});
