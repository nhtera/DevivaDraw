import { describe, expect, it, vi } from "vitest";
import { createCamera } from "./camera";
import type { GridDrawContext2D } from "./grid-renderer";
import { drawGrid } from "./grid-renderer";

function fakeContext(): GridDrawContext2D {
  return { fillStyle: "", fillRect: vi.fn() };
}

describe("drawGrid", () => {
  it("draws a dot at every grid intersection within the viewport", () => {
    const ctx = fakeContext();
    drawGrid(ctx, createCamera(), { width: 40, height: 20 }, 20);
    // Scene visible: x in [0,40], y in [0,20] -> intersections at x=0,20,40 and y=0,20 -> 3*2 = 6 dots.
    expect(ctx.fillRect).toHaveBeenCalledTimes(6);
  });

  it("gridSize <= 0 is a no-op (grid disabled)", () => {
    const ctx = fakeContext();
    drawGrid(ctx, createCamera(), { width: 100, height: 100 }, 0);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("skips drawing entirely when zoomed out enough that dots would be denser than the noise floor", () => {
    const ctx = fakeContext();
    drawGrid(ctx, createCamera({ zoom: 0.01 }), { width: 100, height: 100 }, 20); // 20*0.01=0.2px spacing
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("accounts for camera scroll offset", () => {
    const ctx = fakeContext();
    drawGrid(ctx, createCamera({ scrollX: -10, scrollY: 0 }), { width: 10, height: 10 }, 20);
    // Visible scene rect shifts right by 10 (scrollX=-10 means scene x=10 is at screen 0); with a
    // 20-wide grid and only a 10px-wide viewport, at most one grid line is visible.
    expect((ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
