import { describe, expect, it, vi } from "vitest";
import { createTextElement } from "../elements/text-element";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import { createCamera } from "./camera";
import { drawElementText } from "./text-renderer";
import type { TextDrawContext2D } from "./text-renderer";

function fakeCtx(): TextDrawContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillText: vi.fn(),
  };
}

const measurer = createFixedWidthTextMeasurer(10); // 10px/char, deterministic

describe("drawElementText", () => {
  it("draws nothing for empty text (the DOM overlay is the visible content while mid-edit)", () => {
    const ctx = fakeCtx();
    const element = createTextElement({ x: 0, y: 0, text: "" });
    drawElementText(ctx, element, createCamera(), measurer);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it("draws one fillText call per wrapped line, in order", () => {
    const ctx = fakeCtx();
    const element = createTextElement({ x: 0, y: 0, width: 200, height: 50, text: "first\nsecond" });
    drawElementText(ctx, element, createCamera(), measurer);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).toHaveBeenNthCalledWith(1, "first", expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, "second", expect.any(Number), expect.any(Number));
  });

  it("standalone text (no containerId) never wraps at spaces, only at explicit \\n", () => {
    const ctx = fakeCtx();
    const element = createTextElement({ x: 0, y: 0, width: 5, height: 20, text: "a very long unwrapped line" });
    drawElementText(ctx, element, createCamera(), measurer);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith("a very long unwrapped line", expect.any(Number), expect.any(Number));
  });

  it("bound text (containerId set) wraps to the element's own width", () => {
    const ctx = fakeCtx();
    const element = createTextElement({
      x: 0,
      y: 0,
      width: 90, // 9 chars at 10px/char; each word below is 8 chars (80px), fits alone but not combined
      height: 50,
      text: "aaaaaaaa bbbbbbbb",
      containerId: "container-1",
    });
    drawElementText(ctx, element, createCamera(), measurer);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it("sets ctx.textAlign from the element's textAlign", () => {
    const ctx = fakeCtx();
    const element = createTextElement({ x: 0, y: 0, width: 100, height: 20, text: "hi", textAlign: "right" });
    drawElementText(ctx, element, createCamera(), measurer);
    expect(ctx.textAlign).toBe("right");
  });

  it("anchors the x coordinate at the box's horizontal center for textAlign: center", () => {
    const ctx = fakeCtx();
    const element = createTextElement({ x: 0, y: 0, width: 100, height: 20, text: "hi", textAlign: "center" });
    drawElementText(ctx, element, createCamera(), measurer);
    expect(ctx.fillText).toHaveBeenCalledWith("hi", 50, expect.any(Number));
  });

  it("shifts the text block to the vertical center of the box for verticalAlign: middle", () => {
    const ctx = fakeCtx();
    // fontSize 20 * lineHeight 1.25 (default) = 25px line height, 1 line -> 25px block; box height 100.
    const element = createTextElement({ x: 0, y: 10, width: 100, height: 100, text: "hi", verticalAlign: "middle" });
    drawElementText(ctx, element, createCamera(), measurer);
    // startY = rect.y(10) + (100 - 25) / 2 = 10 + 37.5 = 47.5
    expect(ctx.fillText).toHaveBeenCalledWith("hi", expect.any(Number), 47.5);
  });

  it("scales font size and geometry by camera.zoom", () => {
    const ctx = fakeCtx();
    const element = createTextElement({ x: 0, y: 0, width: 100, height: 20, text: "hi" });
    drawElementText(ctx, element, createCamera({ zoom: 2 }), measurer);
    expect(ctx.font).toContain("40px"); // fontSize 20 * zoom 2
  });

  it("applies a rotate transform when angle is non-zero, but not when it's zero", () => {
    const rotatedCtx = fakeCtx();
    const rotated = createTextElement({ x: 0, y: 0, width: 100, height: 20, text: "hi", angle: 1 });
    drawElementText(rotatedCtx, rotated, createCamera(), measurer);
    expect(rotatedCtx.rotate).toHaveBeenCalledWith(1);

    const uprightCtx = fakeCtx();
    const upright = createTextElement({ x: 0, y: 0, width: 100, height: 20, text: "hi", angle: 0 });
    drawElementText(uprightCtx, upright, createCamera(), measurer);
    expect(uprightCtx.rotate).not.toHaveBeenCalled();
  });
});
