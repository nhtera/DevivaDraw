import { describe, expect, it, vi } from "vitest";
import { createEllipseElement, createRectangleElement, createTriangleElement } from "../elements/shape-elements";
import { createNoteElement } from "../elements/note-element";
import { createCamera } from "./camera";
import { drawBindingHighlights } from "./interactive-binding-highlight";
import type { InteractiveLayerContext } from "./interactive-layer";

/** A recording fake matching the minimal context surface, including the optional `ellipse`. */
function fakeContext(options: { withEllipse?: boolean } = {}) {
  const calls: string[] = [];
  const lineWidths: number[] = [];
  const strokeStyles: string[] = [];
  const ellipseArgs: number[][] = [];
  const linePoints: Array<[number, number]> = [];

  const ctx = {
    canvas: { clientWidth: 800, clientHeight: 600 },
    clearRect: vi.fn(),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("beginPath"),
    moveTo: (x: number, y: number) => {
      calls.push("moveTo");
      linePoints.push([x, y]);
    },
    lineTo: (x: number, y: number) => {
      calls.push("lineTo");
      linePoints.push([x, y]);
    },
    closePath: () => calls.push("closePath"),
    stroke() {
      calls.push("stroke");
      lineWidths.push(ctx.lineWidth);
      strokeStyles.push(String(ctx.strokeStyle));
    },
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: "" as string,
    fillStyle: "" as string,
    lineWidth: 0,
    ...(options.withEllipse
      ? {
          ellipse: (...args: number[]) => {
            calls.push("ellipse");
            ellipseArgs.push(args);
          },
        }
      : {}),
  };

  return { ctx: ctx as unknown as InteractiveLayerContext, calls, lineWidths, strokeStyles, ellipseArgs, linePoints };
}

const CAMERA = createCamera();

describe("drawBindingHighlights", () => {
  it("draws nothing at all for an empty list — not even a save/restore", () => {
    const { ctx, calls } = fakeContext();
    drawBindingHighlights(ctx, [], CAMERA, "light");
    expect(calls).toEqual([]);
  });

  it("strokes a closed path around a rect-kind shape", () => {
    const { ctx, calls, linePoints } = fakeContext();
    drawBindingHighlights(ctx, [createNoteElement({ x: 0, y: 0, width: 100, height: 50 })], CAMERA, "light");

    expect(calls).toEqual(["save", "beginPath", "moveTo", "lineTo", "lineTo", "lineTo", "closePath", "stroke", "restore"]);
    expect(linePoints).toEqual([
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ]);
  });

  it("traces a triangle's real outline, not its bounding box", () => {
    const { ctx, linePoints } = fakeContext();
    drawBindingHighlights(ctx, [createTriangleElement({ x: 0, y: 0, width: 100, height: 50 })], CAMERA, "light");
    expect(linePoints).toEqual([
      [50, 0], // apex
      [100, 50],
      [0, 50],
    ]);
  });

  it("uses a real ellipse primitive for an ellipse-kind shape, passing the element's rotation", () => {
    const { ctx, calls, ellipseArgs } = fakeContext({ withEllipse: true });
    drawBindingHighlights(ctx, [createEllipseElement({ x: 0, y: 0, width: 100, height: 50, angle: 0.5 })], CAMERA, "light");

    expect(calls).toContain("ellipse");
    expect(ellipseArgs[0]).toEqual([50, 25, 50, 25, 0.5, 0, Math.PI * 2]);
  });

  it("skips an ellipse-kind shape rather than throwing on a context without the primitive", () => {
    const { ctx, calls } = fakeContext(); // no `ellipse` member
    expect(() => drawBindingHighlights(ctx, [createEllipseElement({ x: 0, y: 0, width: 100, height: 50 })], CAMERA, "light")).not.toThrow();
    expect(calls).not.toContain("stroke");
  });

  it("picks the stroke colour from the theme", () => {
    const shape = createRectangleElement({ x: 0, y: 0, width: 100, height: 50 });
    const light = fakeContext();
    const dark = fakeContext();
    drawBindingHighlights(light.ctx, [shape], CAMERA, "light");
    drawBindingHighlights(dark.ctx, [shape], CAMERA, "dark");

    expect(light.strokeStyles[0]).toBe("rgba(106,189,252,1)");
    expect(dark.strokeStyles[0]).toBe("rgba(3,93,161,1)");
  });

  it("keeps the halo the same apparent thickness across zoom levels", () => {
    const shape = createRectangleElement({ x: 0, y: 0, width: 100, height: 50, strokeWidth: 2 });
    const widths = [0.25, 1, 4].map((zoom) => {
      const { ctx, lineWidths } = fakeContext();
      drawBindingHighlights(ctx, [shape], { ...CAMERA, zoom }, "light");
      return lineWidths[0]!;
    });

    // Screen-space width, clamped — a 16x zoom range must not produce a 16x thicker halo.
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(1.75);
      expect(width).toBeLessThanOrEqual(4);
    }
  });

  it("gives a heavier-stroked shape a heavier halo, up to the cap", () => {
    const widthFor = (strokeWidth: number) => {
      const { ctx, lineWidths } = fakeContext();
      drawBindingHighlights(ctx, [createRectangleElement({ x: 0, y: 0, width: 100, height: 50, strokeWidth })], CAMERA, "light");
      return lineWidths[0]!;
    };
    expect(widthFor(1)).toBe(1.75); // floored, so a hairline shape still gets a visible halo
    expect(widthFor(3)).toBe(3);
    expect(widthFor(10)).toBe(4); // capped
  });

  it("draws one path per element when several are highlighted at once", () => {
    const { ctx, calls } = fakeContext();
    drawBindingHighlights(
      ctx,
      [createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }), createNoteElement({ x: 300, y: 0, width: 100, height: 50 })],
      CAMERA,
      "light",
    );
    expect(calls.filter((call) => call === "stroke")).toHaveLength(2);
  });
});
