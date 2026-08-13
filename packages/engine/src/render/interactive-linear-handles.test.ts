import { describe, expect, it, vi } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { linearHandleLayout, MIDPOINT_HANDLE_RADIUS_PX, VERTEX_HANDLE_RADIUS_PX } from "../selection/linear-handles";
import { createCamera } from "./camera";
import { drawLinearHandles } from "./interactive-linear-handles";
import type { InteractiveLayerContext } from "./interactive-layer";

function fakeContext(options: { withArc?: boolean } = {}) {
  const calls: string[] = [];
  const circles: Array<{ x: number; y: number; radius: number; fill: string; stroke: string }> = [];

  const ctx = {
    canvas: { clientWidth: 800, clientHeight: 600 },
    clearRect: vi.fn(),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("beginPath"),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: () => calls.push("stroke"),
    fill: () => calls.push("fill"),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: "" as string,
    fillStyle: "" as string,
    lineWidth: 0,
    ...(options.withArc === false
      ? {}
      : {
          arc: (x: number, y: number, radius: number) => {
            calls.push("arc");
            circles.push({ x, y, radius, fill: String(ctx.fillStyle), stroke: String(ctx.strokeStyle) });
          },
        }),
  };

  return { ctx: ctx as unknown as InteractiveLayerContext, calls, circles };
}

const CAMERA = createCamera();
const arrow = () => createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] });

describe("drawLinearHandles", () => {
  it("draws a hollow circle on each vertex — white fill, indigo stroke", () => {
    const { ctx, circles } = fakeContext();
    drawLinearHandles(ctx, linearHandleLayout(arrow(), 1), CAMERA);

    expect(circles).toHaveLength(2);
    for (const circle of circles) {
      expect(circle.radius).toBe(VERTEX_HANDLE_RADIUS_PX);
      expect(circle.fill).toBe("#ffffff");
      expect(circle.stroke).toBe("#6965db");
    }
    expect(circles.map((circle) => circle.x)).toEqual([0, 200]);
  });

  it("fills and strokes each vertex handle, so it reads as hollow rather than solid", () => {
    const { ctx, calls } = fakeContext();
    drawLinearHandles(ctx, linearHandleLayout(arrow(), 1), CAMERA);
    expect(calls.filter((call) => call === "fill")).toHaveLength(2);
    expect(calls.filter((call) => call === "stroke")).toHaveLength(2);
  });

  it("draws no bounding box or outline — the handles and the arrow's own stroke are the whole affordance", () => {
    const { ctx, calls } = fakeContext();
    drawLinearHandles(ctx, linearHandleLayout(arrow(), 1), CAMERA);
    expect(calls).not.toContain("strokeRect");
    expect(calls).not.toContain("lineTo");
  });

  it("adds a translucent midpoint dot, last, when one is offered", () => {
    const { ctx, circles } = fakeContext();
    drawLinearHandles(ctx, linearHandleLayout(arrow(), 1, { x: 100, y: 0 }), CAMERA);

    expect(circles).toHaveLength(3);
    const dot = circles.at(-1)!; // drawn last so it sits above any vertex handle it overlaps
    expect(dot).toMatchObject({ x: 100, y: 0, radius: MIDPOINT_HANDLE_RADIUS_PX, fill: "rgba(105,101,219,0.35)" });
  });

  it("keeps handles the same screen size at any zoom — they are pointer targets, not drawing", () => {
    for (const zoom of [0.25, 1, 4]) {
      const { ctx, circles } = fakeContext();
      drawLinearHandles(ctx, linearHandleLayout(arrow(), zoom), { ...CAMERA, zoom });
      expect(circles[0]!.radius).toBe(VERTEX_HANDLE_RADIUS_PX);
    }
  });

  it("positions handles through the camera", () => {
    const { ctx, circles } = fakeContext();
    drawLinearHandles(ctx, linearHandleLayout(arrow(), 2), { scrollX: 0, scrollY: 0, zoom: 2 });
    expect(circles.map((circle) => circle.x)).toEqual([0, 400]);
  });

  it("draws nothing on a context without a curve primitive rather than substituting squares", () => {
    const { ctx, calls } = fakeContext({ withArc: false });
    expect(() => drawLinearHandles(ctx, linearHandleLayout(arrow(), 1), CAMERA)).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("draws a handle per vertex on a multi-point arrow", () => {
    const bent = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] });
    const { ctx, circles } = fakeContext();
    drawLinearHandles(ctx, linearHandleLayout(bent, 1), CAMERA);
    expect(circles).toHaveLength(3);
  });
});
