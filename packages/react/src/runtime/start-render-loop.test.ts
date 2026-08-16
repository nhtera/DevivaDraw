/**
 * Pins the render loop's crash resilience: the rAF chain re-schedules AFTER each frame renders, so an
 * uncaught throw (one malformed element — e.g. an unvalidated collab-ingested grid — or any renderer
 * bug) would otherwise stop the loop permanently and freeze the board. The loop must catch, warn once
 * per distinct failure, and keep painting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scene } from "@deviva-draw/engine";
import { startRenderLoop } from "./start-render-loop";
import type { RenderLoopDeps } from "./start-render-loop";

function buildDeps(renderImpl: () => void): RenderLoopDeps {
  return {
    stage: {
      staticLayer: { render: renderImpl },
      interactiveLayer: { render: vi.fn() },
      setCursor: vi.fn(),
      onResize: vi.fn(),
    } as unknown as RenderLoopDeps["stage"],
    scene: new Scene(),
    cameraStore: { getCamera: () => ({ scrollX: 0, scrollY: 0, zoom: 1 }) } as RenderLoopDeps["cameraStore"],
    selection: { getSelectedIds: () => new Set<string>() } as unknown as RenderLoopDeps["selection"],
    getMarqueeRect: () => null,
    getSnapGuides: () => [],
    grid: { enabled: false, size: 20 },
    getTextDraft: () => null,
    getPendingEraseIds: () => new Set<string>(),
    getLaserTrail: () => [],
    getLassoPath: () => [],
    getBindingHighlightIds: () => [],
    getBindingAnchor: () => null,
    getTheme: () => "light" as const,
    getHoverPoint: () => null,
    getColorAdapter: () => null,
    getCursor: () => "default",
  };
}

describe("startRenderLoop — crash resilience", () => {
  let frameCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    frameCallbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const pumpFrame = () => {
    const callback = frameCallbacks.shift();
    expect(callback, "the rAF chain must have re-scheduled").toBeTruthy();
    callback!(0);
  };

  it("a throwing frame does not stop the loop, and the same error warns only once", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const render = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("malformed element");
      })
      .mockImplementationOnce(() => {
        throw new Error("malformed element");
      })
      .mockImplementation(() => {});

    const stop = startRenderLoop(buildDeps(render));
    pumpFrame(); // throws — must be caught, chain must survive
    pumpFrame(); // throws again (same message) — no second warn
    pumpFrame(); // healthy frame renders normally
    expect(render).toHaveBeenCalledTimes(3);
    expect(error.mock.calls.filter(([message]) => String(message).includes("render loop"))).toHaveLength(1);
    stop();
  });

  it("distinct failures each get their own warning", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    const render = vi.fn(() => {
      call += 1;
      throw new Error(`failure ${call}`);
    });
    const stop = startRenderLoop(buildDeps(render));
    pumpFrame();
    pumpFrame();
    expect(error.mock.calls.filter(([message]) => String(message).includes("render loop"))).toHaveLength(2);
    stop();
  });
});
