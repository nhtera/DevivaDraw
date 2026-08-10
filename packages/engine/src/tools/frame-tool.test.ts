import { describe, expect, it, vi } from "vitest";
import { Scene } from "../scene/scene";
import { FrameTool } from "./frame-tool";
import type { ShapeToolHistory } from "./drag-shape-tool-base";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

function liveElements(scene: Scene) {
  return scene.getElements().filter((element) => !element.isDeleted);
}

describe("FrameTool", () => {
  it("drags out a named frame committed as one history batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const created: string[] = [];
    const tool = new FrameTool({ scene, history, onCreated: (id) => created.push(id) });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 200, y: 150 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 200, y: 150 }, NO_MODIFIERS);

    const frames = liveElements(scene).filter((element) => element.type === "frame");
    expect(frames).toHaveLength(1);
    const frame = frames[0]!;
    expect(frame.type).toBe("frame");
    expect(frame.width).toBe(200);
    expect(frame.height).toBe(150);
    expect((frame as { name: string }).name).toBe("Frame 1");
    expect(history.beginBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(created).toEqual([frame.id]);
  });

  it("numbers new frames by how many already exist", () => {
    const scene = new Scene();
    const tool = new FrameTool({ scene, history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 100, y: 100 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 300, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 400, y: 100 }, NO_MODIFIERS);

    const names = liveElements(scene)
      .filter((element) => element.type === "frame")
      .map((element) => (element as { name: string }).name);
    expect(names).toEqual(["Frame 1", "Frame 2"]);
  });

  it("a plain click drops a default-sized frame centered on the click", () => {
    const scene = new Scene();
    const tool = new FrameTool({ scene, history: fakeHistory() });
    tool.onGestureStart({ x: 100, y: 100 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 100, y: 100 }, NO_MODIFIERS);

    const frame = liveElements(scene).find((element) => element.type === "frame")!;
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
    // Centered on the click point.
    expect(frame.x + frame.width / 2).toBe(100);
    expect(frame.y + frame.height / 2).toBe(100);
  });

  it("aborting soft-deletes the draft frame", () => {
    const scene = new Scene();
    const tool = new FrameTool({ scene, history: fakeHistory() });
    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);
    expect(liveElements(scene).filter((element) => element.type === "frame")).toEqual([]);
  });
});
