import { describe, expect, it } from "vitest";
import { buildRoomUrl, buildRoomWebSocketUrl, parseRoomUrl } from "./room-url";

describe("buildRoomUrl / parseRoomUrl", () => {
  it("round trips a room id and key through the URL fragment", () => {
    const url = buildRoomUrl({ origin: "https://draw.deviva.app", roomId: "room-123", keyBase64Url: "abc_-XYZ" });
    expect(url).toBe("https://draw.deviva.app/room/room-123#key=abc_-XYZ");

    const parsed = new URL(url);
    const result = parseRoomUrl(parsed.pathname, parsed.hash);
    expect(result).toEqual({ ok: true, value: { roomId: "room-123", keyBase64Url: "abc_-XYZ" } });
  });

  it("strips a trailing slash from the origin", () => {
    const url = buildRoomUrl({ origin: "https://draw.deviva.app/", roomId: "r1", keyBase64Url: "k" });
    expect(url.startsWith("https://draw.deviva.app/room/")).toBe(true);
  });

  it("percent-encodes a room id containing reserved characters", () => {
    const url = buildRoomUrl({ origin: "https://draw.deviva.app", roomId: "a/b", keyBase64Url: "k" });
    expect(url).toContain("/room/a%2Fb");
  });

  it("rejects a path that isn't /room/{id}", () => {
    expect(parseRoomUrl("/not-a-room/x", "#key=k")).toEqual({
      ok: false,
      reason: "invalid-path",
      error: 'room URL path must be "/room/{roomId}"',
    });
  });

  it("rejects a fragment missing the key", () => {
    const result = parseRoomUrl("/room/r1", "");
    expect(result).toEqual({ ok: false, reason: "missing-key", error: "room URL fragment is missing the decryption key" });
  });

  it("accepts a fragment with or without a leading #", () => {
    expect(parseRoomUrl("/room/r1", "key=k1")).toEqual({ ok: true, value: { roomId: "r1", keyBase64Url: "k1" } });
    expect(parseRoomUrl("/room/r1", "#key=k1")).toEqual({ ok: true, value: { roomId: "r1", keyBase64Url: "k1" } });
  });
});

describe("buildRoomWebSocketUrl", () => {
  it("converts https to wss and appends the room path", () => {
    expect(buildRoomWebSocketUrl("https://collab.example", "room-1")).toBe("wss://collab.example/room/room-1");
  });

  it("converts http to ws for local dev", () => {
    expect(buildRoomWebSocketUrl("http://localhost:8788", "room-1")).toBe("ws://localhost:8788/room/room-1");
  });

  it("strips a trailing slash before appending the room path", () => {
    expect(buildRoomWebSocketUrl("http://localhost:8788/", "room-1")).toBe("ws://localhost:8788/room/room-1");
  });
});
