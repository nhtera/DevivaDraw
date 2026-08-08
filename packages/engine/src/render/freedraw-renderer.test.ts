import { describe, expect, it, vi } from "vitest";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createCamera } from "./camera";
import { buildFreedrawStrokeOptions, computeFreedrawOutline, drawElementFreedraw, freedrawSceneRadius } from "./freedraw-renderer";
import type { FreedrawDrawContext2D } from "./freedraw-renderer";

function fakeCtx(): FreedrawDrawContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
  };
}

function zigzagPoints(count: number): Array<readonly [number, number, number]> {
  return Array.from({ length: count }, (_, i) => [i * 5, i % 2 === 0 ? 0 : 5, 0.5] as const);
}

describe("buildFreedrawStrokeOptions", () => {
  it("scales size by strokeWidth and camera zoom", () => {
    const element = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]], strokeWidth: 2 });
    const options = buildFreedrawStrokeOptions(element, createCamera({ zoom: 3 }));
    expect(options.size).toBeGreaterThan(0);
    expect(options.size).toBe(buildFreedrawStrokeOptions(element, createCamera({ zoom: 1 })).size * 3);
  });

  it("carries the element's simulatePressure flag through verbatim", () => {
    const simulated = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]], simulatePressure: true });
    const real = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]], simulatePressure: false });
    expect(buildFreedrawStrokeOptions(simulated, createCamera()).simulatePressure).toBe(true);
    expect(buildFreedrawStrokeOptions(real, createCamera()).simulatePressure).toBe(false);
  });
});

describe("freedrawSceneRadius", () => {
  it("scales with strokeWidth but is independent of camera zoom (scene-space, not screen-space)", () => {
    expect(freedrawSceneRadius(2)).toBe(freedrawSceneRadius(1) * 2);
  });

  it("is always positive for a positive strokeWidth", () => {
    expect(freedrawSceneRadius(1)).toBeGreaterThan(0);
  });
});

describe("computeFreedrawOutline — determinism", () => {
  it("returns an empty array for an element with no points", () => {
    const element = createFreedrawElement({ x: 0, y: 0, points: [] });
    expect(computeFreedrawOutline(element, createCamera())).toEqual([]);
  });

  it("returns a non-empty closed polygon for a multi-point stroke", () => {
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6) });
    const outline = computeFreedrawOutline(element, createCamera());
    expect(outline.length).toBeGreaterThan(0);
    for (const vertex of outline) expect(vertex).toHaveLength(2);
  });

  it("produces byte-identical outlines for the same element/camera across two calls (no hidden randomness)", () => {
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6), seed: 1 });
    const camera = createCamera();
    expect(computeFreedrawOutline(element, camera)).toEqual(computeFreedrawOutline(element, camera));
  });

  it("produces a different outline when the camera zoom changes (screen-space geometry, not scene-space)", () => {
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6) });
    const atZoom1 = computeFreedrawOutline(element, createCamera({ zoom: 1 }));
    const atZoom2 = computeFreedrawOutline(element, createCamera({ zoom: 2 }));
    expect(atZoom1).not.toEqual(atZoom2);
  });
});

describe("drawElementFreedraw", () => {
  it("wraps the fill call in save/restore, sets fillStyle from strokeColor, and sets globalAlpha from opacity", () => {
    const ctx = fakeCtx();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6), strokeColor: "#123456", opacity: 50 });

    drawElementFreedraw(ctx, element, createCamera());

    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(ctx.globalAlpha).toBe(0.5);
    expect(ctx.fillStyle).toBe("#123456");
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

  it("skips drawing entirely (no save/fill) for an element with no points", () => {
    const ctx = fakeCtx();
    const element = createFreedrawElement({ x: 0, y: 0, points: [] });

    drawElementFreedraw(ctx, element, createCamera());

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it("applies a rotate transform around the element's screen-space bbox center when angle is non-zero", () => {
    const ctx = fakeCtx();
    const element = createFreedrawElement({
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      points: zigzagPoints(6),
      angle: Math.PI / 4,
    });

    drawElementFreedraw(ctx, element, createCamera());

    expect(ctx.translate).toHaveBeenCalledWith(10, 10);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 4);
    expect(ctx.translate).toHaveBeenCalledWith(-10, -10);
  });

  it("skips the rotate transform entirely when angle is 0", () => {
    const ctx = fakeCtx();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6), angle: 0 });

    drawElementFreedraw(ctx, element, createCamera());

    expect(ctx.rotate).not.toHaveBeenCalled();
  });
});
