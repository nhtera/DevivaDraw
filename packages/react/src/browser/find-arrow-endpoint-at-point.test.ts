import { describe, expect, it } from "vitest";
import { createArrowElement } from "@deviva-draw/engine";
import type { ArrowElement } from "@deviva-draw/engine";
import { findArrowEndpointAt } from "./find-arrow-endpoint-at-point";

/** A horizontal arrow from (0,0) to (100,0). */
function arrow(): ArrowElement {
  return {
    ...createArrowElement({
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    }),
    version: 1,
    versionNonce: 1,
    updated: 1,
    index: "a",
  };
}

describe("findArrowEndpointAt", () => {
  it("hits the start tip for a point near the first vertex", () => {
    expect(findArrowEndpointAt(arrow(), { x: 3, y: 2 }, 12)).toBe("start");
  });

  it("hits the end tip for a point near the last vertex", () => {
    expect(findArrowEndpointAt(arrow(), { x: 98, y: -4 }, 12)).toBe("end");
  });

  it("returns null for a point on the arrow's body, so the label editor still gets that gesture", () => {
    expect(findArrowEndpointAt(arrow(), { x: 50, y: 0 }, 12)).toBeNull();
  });

  it("returns null for a point off the arrow entirely", () => {
    expect(findArrowEndpointAt(arrow(), { x: 50, y: 400 }, 12)).toBeNull();
  });

  it("picks the NEARER tip when a short arrow puts both in range", () => {
    const short = {
      ...arrow(),
      width: 10,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    expect(findArrowEndpointAt(short, { x: 1, y: 0 }, 12)).toBe("start");
    expect(findArrowEndpointAt(short, { x: 9, y: 0 }, 12)).toBe("end");
  });

  it("respects the threshold — a tighter radius stops claiming the same point", () => {
    expect(findArrowEndpointAt(arrow(), { x: 10, y: 0 }, 12)).toBe("start");
    expect(findArrowEndpointAt(arrow(), { x: 10, y: 0 }, 4)).toBeNull();
  });
});
