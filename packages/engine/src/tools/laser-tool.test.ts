import { describe, expect, it } from "vitest";
import { LaserTool, LASER_FADE_MS } from "./laser-tool";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

/** A controllable clock so the fade is deterministic (no real time / Date.now). */
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("LaserTool", () => {
  it("records dragged points into the trail, freshest at full opacity", () => {
    const clock = fakeClock();
    const tool = new LaserTool({ now: clock.now });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 10, y: 10 }, NO_MODIFIERS);

    const trail = tool.getTrail();
    expect(trail).toHaveLength(2);
    expect(trail.at(-1)).toMatchObject({ x: 10, y: 10 });
    expect(trail.at(-1)!.opacity).toBeCloseTo(1, 5); // just added → fully opaque
  });

  it("fades a point's opacity toward zero as it ages", () => {
    const clock = fakeClock();
    const tool = new LaserTool({ now: clock.now });
    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);

    clock.advance(LASER_FADE_MS / 2);
    expect(tool.getTrail()[0]!.opacity).toBeCloseTo(0.5, 5);
  });

  it("prunes points once they fully fade, so the trail dissolves after release", () => {
    const clock = fakeClock();
    const tool = new LaserTool({ now: clock.now });
    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 5, y: 5 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 5, y: 5 }, NO_MODIFIERS); // released, but points remain and age out

    expect(tool.getTrail().length).toBeGreaterThan(0);
    clock.advance(LASER_FADE_MS + 1);
    expect(tool.getTrail()).toHaveLength(0);
  });

  it("never touches a scene or history (purely ephemeral) — it takes no such deps", () => {
    // Constructing with no deps must work: the tool has nothing to persist.
    expect(() => new LaserTool()).not.toThrow();
  });
});
