import { describe, expect, it } from "vitest";
import { lanHostErrorReason, lanRelayBaseUrl } from "./lan-host-controller";

describe("lanRelayBaseUrl", () => {
  it("builds a base URL a room link can be assembled from", () => {
    expect(lanRelayBaseUrl("192.168.1.5", 7373)).toBe("http://192.168.1.5:7373");
  });
});

describe("lanHostErrorReason", () => {
  /**
   * The host process reports codes, not sentences, so the UI can translate them. Tauri wraps a
   * rejected command's string in an `Error`, so both shapes have to map.
   */
  it("recognises each reason the host process can report, thrown or rejected", () => {
    expect(lanHostErrorReason("port-in-use")).toBe("port-in-use");
    expect(lanHostErrorReason(new Error("permission-denied"))).toBe("permission-denied");
    expect(lanHostErrorReason("already-hosting")).toBe("already-hosting");
  });

  it("falls back to a generic failure for anything it does not recognise", () => {
    expect(lanHostErrorReason(new Error("bind-failed: address family not supported"))).toBe("start-failed");
    expect(lanHostErrorReason(undefined)).toBe("start-failed");
    expect(lanHostErrorReason({ weird: true })).toBe("start-failed");
  });
});
