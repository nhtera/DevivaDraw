import { describe, expect, it, vi } from "vitest";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createCamera } from "./camera";
import { buildFreedrawStrokeOptions, drawElementFreedraw } from "./freedraw-renderer";
import type { FreedrawDrawContext2D } from "./freedraw-renderer";

const CAMERA = createCamera();

function fakeContext(): FreedrawDrawContext2D & { globalCompositeOperation: string; globalAlpha: number } {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
  };
}

describe("highlighter freedraw", () => {
  it("defaults to non-highlighter ink", () => {
    const ink = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]] });
    expect(ink.highlighter).toBe(false);
  });

  it("draws a highlighter with a broader nib and no pressure taper", () => {
    const ink = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]], strokeWidth: 2 });
    const marker = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]], strokeWidth: 2, highlighter: true });
    const inkOpts = buildFreedrawStrokeOptions(ink, CAMERA);
    const markerOpts = buildFreedrawStrokeOptions(marker, CAMERA);

    expect(markerOpts.size).toBeGreaterThan(inkOpts.size); // broader swath
    expect(markerOpts.thinning).toBe(0); // constant width, no taper
    expect(markerOpts.simulatePressure).toBe(false);
  });

  it("composites a highlighter with multiply and reduced alpha; plain ink stays source-over at full alpha", () => {
    // Capture composite/alpha at the moment of the fill() (before the wrapping restore() would reset them).
    const capture = (ctx: ReturnType<typeof fakeContext>) => {
      const seen = { composite: "", alpha: 1 };
      ctx.fill = vi.fn(() => {
        seen.composite = ctx.globalCompositeOperation;
        seen.alpha = ctx.globalAlpha;
      });
      return seen;
    };

    const marker = createFreedrawElement({ x: 0, y: 0, width: 10, height: 10, points: [[0, 0, 1], [10, 10, 1]], highlighter: true });
    const markerCtx = fakeContext();
    const markerSeen = capture(markerCtx);
    drawElementFreedraw(markerCtx, marker, CAMERA);
    expect(markerSeen.composite).toBe("multiply");
    expect(markerSeen.alpha).toBeLessThan(1);

    const ink = createFreedrawElement({ x: 0, y: 0, width: 10, height: 10, points: [[0, 0, 1], [10, 10, 1]] });
    const inkCtx = fakeContext();
    const inkSeen = capture(inkCtx);
    drawElementFreedraw(inkCtx, ink, CAMERA);
    expect(inkSeen.composite).toBe("source-over"); // untouched
    expect(inkSeen.alpha).toBe(1);
  });
});
