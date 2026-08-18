import { describe, expect, it } from "vitest";
import type { RemotePeerPresence } from "@deviva-draw/collab-client";
import { canFollow } from "./use-collab-session";

/**
 * Only `canFollow` is covered — the hook itself is React lifecycle wiring this package deliberately
 * does not test (see `runtime/use-live-version.ts`'s module doc). The rule is extracted precisely so
 * it can be: it decides both which Follow buttons are offered and when a live follow ends, and the
 * page-switch half of it is the case that produced a visible camera jump when it was missing.
 */
function peer(overrides: Partial<RemotePeerPresence> = {}): RemotePeerPresence {
  return {
    peerId: "p1",
    name: "Ann",
    color: "#f00",
    point: null,
    selectedElementIds: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    idle: false,
    ...overrides,
  };
}

describe("canFollow", () => {
  it("follows a peer on the same page", () => {
    expect(canFollow(peer({ pageId: "page-1" }), "page-1")).toBe(true);
  });

  it("refuses a peer on another page — their viewport describes a camera over content nobody here is looking at", () => {
    expect(canFollow(peer({ pageId: "page-2" }), "page-1")).toBe(false);
  });

  it("refuses a peer that has left", () => {
    expect(canFollow(undefined, "page-1")).toBe(false);
  });

  it("refuses a peer that has never published a viewport", () => {
    expect(canFollow(peer({ viewport: null, pageId: "page-1" }), "page-1")).toBe(false);
  });

  it("follows a peer with no page at all — a pre-pages client is everywhere, not nowhere", () => {
    expect(canFollow(peer(), "page-1")).toBe(true);
  });

  it("follows any peer when this host has no pages of its own", () => {
    expect(canFollow(peer({ pageId: "page-9" }), null)).toBe(true);
  });
});
