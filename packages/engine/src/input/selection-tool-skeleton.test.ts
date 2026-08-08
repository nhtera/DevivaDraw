import { describe, expect, it, vi } from "vitest";
import { SelectionToolSkeleton } from "./selection-tool-skeleton";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

describe("SelectionToolSkeleton", () => {
  it("calls onEmptyCanvasClick when a gesture ends", () => {
    const onEmptyCanvasClick = vi.fn();
    const tool = new SelectionToolSkeleton({ onEmptyCanvasClick });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);

    expect(onEmptyCanvasClick).toHaveBeenCalledTimes(1);
  });

  it("does not call the callback on gesture start, move, or cancel — only on end", () => {
    const onEmptyCanvasClick = vi.fn();
    const tool = new SelectionToolSkeleton({ onEmptyCanvasClick });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 5, y: 5 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);

    expect(onEmptyCanvasClick).not.toHaveBeenCalled();
  });

  it("works with no deps supplied (optional callback)", () => {
    const tool = new SelectionToolSkeleton();
    expect(() => tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS)).not.toThrow();
  });
});
