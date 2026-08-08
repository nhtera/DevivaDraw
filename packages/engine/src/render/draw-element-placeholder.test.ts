import { describe, expect, it, vi } from "vitest";
import { createGenericElement } from "../elements/element-types";
import type { Camera } from "./camera";
import { createCamera } from "./camera";
import { drawElementPlaceholder } from "./draw-element-placeholder";
import type { DrawContext2D } from "./draw-element-placeholder";

function fakeContext(): DrawContext2D {
  return { strokeStyle: "", lineWidth: 0, strokeRect: vi.fn() };
}

describe("drawElementPlaceholder", () => {
  it("strokes a rect at the element's screen-space position and size under an identity camera", () => {
    const ctx = fakeContext();
    const element = createGenericElement({ x: 10, y: 20, width: 30, height: 40 });

    drawElementPlaceholder(ctx, element, createCamera());

    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 30, 40);
  });

  it("scales position and size by the camera's zoom and applies the scroll offset", () => {
    const ctx = fakeContext();
    const element = createGenericElement({ x: 0, y: 0, width: 10, height: 10 });
    const camera: Camera = { scrollX: 5, scrollY: 5, zoom: 2 };

    drawElementPlaceholder(ctx, element, camera);

    // (x + scrollX) * zoom = (0 + 5) * 2 = 10; size scales by zoom only: 10 * 2 = 20
    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 10, 20, 20);
  });

  it("sets strokeStyle from the element's strokeColor", () => {
    const ctx = fakeContext();
    const element = createGenericElement({ x: 0, y: 0, strokeColor: "#ff00ff" });

    drawElementPlaceholder(ctx, element, createCamera());

    expect(ctx.strokeStyle).toBe("#ff00ff");
  });

  it("scales lineWidth by zoom but never below 1px", () => {
    const ctx = fakeContext();
    const element = createGenericElement({ x: 0, y: 0, strokeWidth: 2 });

    drawElementPlaceholder(ctx, element, { scrollX: 0, scrollY: 0, zoom: 0.1 });
    expect(ctx.lineWidth).toBe(1);

    drawElementPlaceholder(ctx, element, { scrollX: 0, scrollY: 0, zoom: 5 });
    expect(ctx.lineWidth).toBe(10);
  });
});
