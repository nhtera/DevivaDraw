import rough from "roughjs";
import { describe, expect, it, vi } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createCamera } from "./camera";
import { buildArrowDrawables, drawElementArrow } from "./arrow-renderer";
import type { RoughDrawContext2D } from "./rough-renderer";

const generator = rough.generator();

function fakeCtx(): RoughDrawContext2D {
  return { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), globalAlpha: 1 };
}

describe("buildArrowDrawables", () => {
  it("returns [] for an arrow with fewer than 2 points", () => {
    const element = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }] });
    expect(buildArrowDrawables(generator, element, createCamera())).toEqual([]);
  });

  it("straight arrowType dispatches the shaft via linearPath", () => {
    const element = createArrowElement({
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      arrowType: "straight",
      endArrowhead: "none",
      startArrowhead: "none",
    });
    const drawables = buildArrowDrawables(generator, element, createCamera());
    expect(drawables).toHaveLength(1); // shaft only, no arrowheads
    expect(drawables[0]?.shape).toBe("linearPath");
  });

  it("curved arrowType dispatches the shaft via path (smoothed curve)", () => {
    const element = createArrowElement({
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }],
      arrowType: "curved",
      endArrowhead: "none",
      startArrowhead: "none",
    });
    const drawables = buildArrowDrawables(generator, element, createCamera());
    expect(drawables[0]?.shape).toBe("path");
  });

  it("elbow arrowType falls back to the straight linearPath shaft (explicitly deferred routing mode)", () => {
    const element = createArrowElement({
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      arrowType: "elbow",
      endArrowhead: "none",
      startArrowhead: "none",
    });
    const drawables = buildArrowDrawables(generator, element, createCamera());
    expect(drawables[0]?.shape).toBe("linearPath");
  });

  it("'none' arrowhead produces no extra drawable; every other style produces exactly one per end", () => {
    const base = { x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } as const;

    expect(buildArrowDrawables(generator, createArrowElement({ ...base, startArrowhead: "none", endArrowhead: "none" }), createCamera())).toHaveLength(1);

    for (const style of ["arrow", "bar", "dot", "triangle"] as const) {
      const drawables = buildArrowDrawables(generator, createArrowElement({ ...base, startArrowhead: "none", endArrowhead: style }), createCamera());
      expect(drawables).toHaveLength(2); // shaft + 1 head
    }
  });

  it("both ends styled produces shaft + 2 heads", () => {
    const element = createArrowElement({
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      startArrowhead: "bar",
      endArrowhead: "triangle",
    });
    expect(buildArrowDrawables(generator, element, createCamera())).toHaveLength(3);
  });

  it("triangle and dot heads are filled shapes (polygon / ellipse)", () => {
    const triangle = createArrowElement({
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      startArrowhead: "none",
      endArrowhead: "triangle",
    });
    expect(buildArrowDrawables(generator, triangle, createCamera())[1]?.shape).toBe("polygon");

    const dot = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], startArrowhead: "none", endArrowhead: "dot" });
    expect(buildArrowDrawables(generator, dot, createCamera())[1]?.shape).toBe("ellipse");
  });
});

describe("drawElementArrow", () => {
  it("wraps the draw call in save/restore and applies opacity", () => {
    const ctx = fakeCtx();
    const roughCanvas = { rectangle: vi.fn(), ellipse: vi.fn(), polygon: vi.fn(), linearPath: vi.fn(), path: vi.fn(), draw: vi.fn() };
    const element = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], opacity: 40 });

    drawElementArrow(ctx, roughCanvas, element, createCamera());

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(ctx.globalAlpha).toBe(0.4);
    expect(roughCanvas.linearPath).toHaveBeenCalled(); // shaft
  });

  it("applies a rotate transform around the arrow's screen-space bbox center when angle is non-zero", () => {
    const ctx = fakeCtx();
    const roughCanvas = { rectangle: vi.fn(), ellipse: vi.fn(), polygon: vi.fn(), linearPath: vi.fn(), path: vi.fn(), draw: vi.fn() };
    const element = createArrowElement({ x: 0, y: 0, width: 20, height: 20, points: [{ x: 0, y: 0 }, { x: 20, y: 20 }], angle: Math.PI / 4 });

    drawElementArrow(ctx, roughCanvas, element, createCamera());

    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 4);
  });
});
