import { describe, expect, it, vi } from "vitest";
import { createEllipseElement, createRectangleElement, createTriangleElement } from "../elements/shape-elements";
import { createNoteElement } from "../elements/note-element";
import { CONNECTION_POINT_RADIUS_PX, CONNECTION_POINT_SNAP_PX } from "../bindings/shape-connection-points";
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

/** A context that can draw circles, so the connection-anchor dots are recorded rather than skipped. */
function fakeContextWithArc() {
  const dots: Array<{ x: number; y: number; radius: number; fill: string }> = [];
  const base = fakeContext();
  const ctx = base.ctx as unknown as Record<string, unknown>;
  ctx.arc = (x: number, y: number, radius: number) => dots.push({ x, y, radius, fill: String(ctx.fillStyle) });
  return { ...base, dots };
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

describe("drawBindingHighlights — connection anchors", () => {
  it("marks the four anchors of every highlighted shape", () => {
    const { ctx, dots } = fakeContextWithArc();
    drawBindingHighlights(ctx, [createRectangleElement({ x: 0, y: 0, width: 100, height: 60 })], CAMERA, "light");

    expect(dots.map((dot) => [dot.x, dot.y])).toEqual([
      [50, 0],
      [100, 30],
      [50, 60],
      [0, 30],
    ]);
  });

  it("draws them in grey, not the halo's blue — the halo says which shape, the dots say where on it", () => {
    const { ctx, dots } = fakeContextWithArc();
    drawBindingHighlights(ctx, [createRectangleElement({ x: 0, y: 0, width: 100, height: 60 })], CAMERA, "light");
    for (const dot of dots) expect(dot.fill).toBe("rgba(105,105,105,0.9)");
  });

  it("uses a lighter grey on the dark canvas, as the halo does", () => {
    const { ctx, dots } = fakeContextWithArc();
    drawBindingHighlights(ctx, [createRectangleElement({ x: 0, y: 0, width: 100, height: 60 })], CAMERA, "dark");
    expect(dots[0]!.fill).toBe("rgba(190,190,190,0.9)");
  });

  it("keeps the dots a fixed screen size, since they are pointer targets rather than drawing", () => {
    for (const zoom of [0.5, 1, 3]) {
      const { ctx, dots } = fakeContextWithArc();
      drawBindingHighlights(ctx, [createRectangleElement({ x: 0, y: 0, width: 100, height: 60 })], { ...CAMERA, zoom }, "light");
      expect(dots[0]!.radius).toBe(CONNECTION_POINT_RADIUS_PX);
    }
  });

  it("marks every shape in the list, so both ends of an arrow spanning two shapes show their anchors", () => {
    const { ctx, dots } = fakeContextWithArc();
    const shapes = [createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }), createRectangleElement({ x: 200, y: 0, width: 40, height: 40 })];
    drawBindingHighlights(ctx, shapes, CAMERA, "light");
    expect(dots).toHaveLength(8);
  });

  it("skips the dots entirely on a context without a curve primitive, rather than substituting squares", () => {
    const { ctx, calls } = fakeContext();
    drawBindingHighlights(ctx, [createRectangleElement({ x: 0, y: 0, width: 100, height: 60 })], CAMERA, "light");
    expect(calls).not.toContain("fill");
  });
});

describe("drawBindingHighlights — active anchor ring", () => {
  const shape = () => createRectangleElement({ x: 0, y: 0, width: 100, height: 60 });

  it("rings the active anchor at the snap radius and refills its dot, on top of the four grey dots", () => {
    const { ctx, dots } = fakeContextWithArc();
    drawBindingHighlights(ctx, [shape()], CAMERA, "light", { x: 100, y: 30 });

    const atAnchor = dots.filter((dot) => dot.x === 100 && dot.y === 30);
    expect(atAnchor.map((dot) => dot.radius)).toContain(CONNECTION_POINT_SNAP_PX); // the ring IS the snap zone
    expect(atAnchor.map((dot) => dot.radius)).toContain(CONNECTION_POINT_RADIUS_PX + 1); // the armed dot refill
    expect(dots).toHaveLength(6); // 4 grey dots + ring + refill
  });

  it("draws no ring when no anchor is active — four dots only, exactly as before", () => {
    const { ctx, dots } = fakeContextWithArc();
    drawBindingHighlights(ctx, [shape()], CAMERA, "light", null);
    expect(dots).toHaveLength(4);
  });

  it("places the ring in screen space, following the camera like every other overlay", () => {
    const { ctx, dots } = fakeContextWithArc();
    drawBindingHighlights(ctx, [shape()], { ...CAMERA, zoom: 2 }, "light", { x: 100, y: 30 });
    const ring = dots.find((dot) => dot.radius === CONNECTION_POINT_SNAP_PX);
    expect([ring!.x, ring!.y]).toEqual([200, 60]); // scene (100,30) at 2x
  });
});
