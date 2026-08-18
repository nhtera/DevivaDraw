import { describe, expect, it } from "vitest";
import { buildRoomUrl, buildRoomWebSocketUrl, parseRoomUrl, readRelayBaseUrl, roleClaimedByToken } from "./room-url";

describe("buildRoomUrl / parseRoomUrl", () => {
  it("round trips a room id and key through the URL fragment", () => {
    const url = buildRoomUrl({ origin: "https://draw.deviva.app", roomId: "room-123", keyBase64Url: "abc_-XYZ" });
    expect(url).toBe("https://draw.deviva.app/room/room-123#key=abc_-XYZ");

    const parsed = new URL(url);
    const result = parseRoomUrl(parsed.pathname, parsed.hash);
    expect(result).toEqual({ ok: true, value: { roomId: "room-123", keyBase64Url: "abc_-XYZ", token: null, relayBaseUrl: null } });
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
    expect(parseRoomUrl("/room/r1", "key=k1")).toEqual({ ok: true, value: { roomId: "r1", keyBase64Url: "k1", token: null, relayBaseUrl: null } });
    expect(parseRoomUrl("/room/r1", "#key=k1")).toEqual({ ok: true, value: { roomId: "r1", keyBase64Url: "k1", token: null, relayBaseUrl: null } });
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

describe("role tokens in a room URL", () => {
  it("puts the token in the query and the key in the fragment — the relay must see one and never the other", () => {
    const url = buildRoomUrl({ origin: "https://draw.deviva.app", roomId: "r1", keyBase64Url: "k1", token: "viewer.mac" });
    expect(url).toBe("https://draw.deviva.app/room/r1?t=viewer.mac#key=k1");

    const parsed = new URL(url);
    expect(parseRoomUrl(parsed.pathname, parsed.hash, parsed.search)).toEqual({
      ok: true,
      value: { roomId: "r1", keyBase64Url: "k1", token: "viewer.mac", relayBaseUrl: null },
    });
  });

  it("reads no token when the caller does not pass the query — a pre-roles link parses as tokenless", () => {
    const url = buildRoomUrl({ origin: "https://draw.deviva.app", roomId: "r1", keyBase64Url: "k1", token: "viewer.mac" });
    const parsed = new URL(url);
    expect(parseRoomUrl(parsed.pathname, parsed.hash)).toEqual({ ok: true, value: { roomId: "r1", keyBase64Url: "k1", token: null, relayBaseUrl: null } });
  });

  it("carries the token onto the WebSocket URL, which is the only place it is of any use", () => {
    expect(buildRoomWebSocketUrl("https://collab.example", "r1", "viewer.mac")).toBe("wss://collab.example/room/r1?t=viewer.mac");
    expect(buildRoomWebSocketUrl("https://collab.example", "r1", null)).toBe("wss://collab.example/room/r1");
  });

  it("reads the role a token claims, defaulting to editor for anything it does not recognise", () => {
    expect(roleClaimedByToken("viewer.mac")).toBe("viewer");
    expect(roleClaimedByToken("editor.mac")).toBe("editor");
    expect(roleClaimedByToken(null)).toBe("editor");
    expect(roleClaimedByToken(undefined)).toBe("editor");
    expect(roleClaimedByToken("nonsense")).toBe("editor");
    // Not a prefix match on a longer word: "viewerish." must not read as viewer.
    expect(roleClaimedByToken("viewerish.mac")).toBe("editor");
  });
});

describe("a self-hosted room's relay", () => {
  it("rides in the query beside the token, leaving the key alone in the fragment", () => {
    const url = buildRoomUrl({ origin: "http://192.168.1.5:7373", roomId: "r1", keyBase64Url: "k1", token: "editor.mac", relayBaseUrl: "http://192.168.1.5:7373" });

    const parsed = new URL(url);
    expect(parsed.hash).toBe("#key=k1");
    expect(parseRoomUrl(parsed.pathname, parsed.hash, parsed.search)).toEqual({
      ok: true,
      value: { roomId: "r1", keyBase64Url: "k1", token: "editor.mac", relayBaseUrl: "http://192.168.1.5:7373" },
    });
  });

  it("is absent from a link to the configured relay, which needs no such field", () => {
    const url = buildRoomUrl({ origin: "https://draw.deviva.app", roomId: "r1", keyBase64Url: "k1", token: "editor.mac" });
    expect(url).toBe("https://draw.deviva.app/room/r1?t=editor.mac#key=k1");
  });

  it("accepts every address a local network actually uses", () => {
    for (const host of ["http://192.168.1.5:7373", "http://10.0.0.7:7373", "http://172.16.0.1:7373", "http://172.31.255.254:7373", "http://169.254.3.4:7373", "http://127.0.0.1:7373", "http://localhost:7373"]) {
      expect(readRelayBaseUrl(host)).toBe(new URL(host).origin);
    }
  });

  /**
   * The field is an instruction from a pasted link, so this is the test that matters: a hostile link
   * must not be able to point this client's socket at a host of its choosing. It cannot read a board
   * either way — the relay only ever holds ciphertext — but opening the connection at all is not
   * something a whiteboard should do on a stranger's say-so.
   */
  it("ignores any address that is not on a local network, falling back to the configured relay", () => {
    for (const host of ["https://evil.example", "http://8.8.8.8", "http://203.0.113.9:7373", "http://172.15.0.1", "http://172.32.0.1", "http://192.167.0.1", "http://192.169.0.1", "ftp://192.168.1.5", "javascript:alert(1)", "not a url", ""]) {
      expect(readRelayBaseUrl(host)).toBeNull();
    }
    expect(readRelayBaseUrl(null)).toBeNull();
  });

  it("rejects octets that only look numeric", () => {
    expect(readRelayBaseUrl("http://192.168.1.999")).toBeNull();
  });
});
