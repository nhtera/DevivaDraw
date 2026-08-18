import { describe, expect, it } from "vitest";
import { mintRoleToken, verifyRoleToken } from "./room-role-token";

const SECRET = "test-secret-not-a-real-one";
const ROOM = "550e8400-e29b-41d4-a716-446655440000";

describe("room role tokens", () => {
  it("names its role in the clear, so the client holding the link knows what kind it is", async () => {
    expect(await mintRoleToken(SECRET, ROOM, "viewer")).toMatch(/^viewer\./);
    expect(await mintRoleToken(SECRET, ROOM, "editor")).toMatch(/^editor\./);
  });

  it("verifies a token back to the role it was minted for", async () => {
    expect(await verifyRoleToken(SECRET, ROOM, await mintRoleToken(SECRET, ROOM, "editor"))).toBe("editor");
    expect(await verifyRoleToken(SECRET, ROOM, await mintRoleToken(SECRET, ROOM, "viewer"))).toBe("viewer");
  });

  it("mints different tokens for the two roles — otherwise the whole feature is a no-op", async () => {
    expect(await mintRoleToken(SECRET, ROOM, "editor")).not.toBe(await mintRoleToken(SECRET, ROOM, "viewer"));
  });

  it("is deterministic, so verification needs no stored state", async () => {
    expect(await mintRoleToken(SECRET, ROOM, "editor")).toBe(await mintRoleToken(SECRET, ROOM, "editor"));
  });

  it("rejects a token minted for a different room — a viewer token cannot be replayed elsewhere", async () => {
    const token = await mintRoleToken(SECRET, ROOM, "editor");
    expect(await verifyRoleToken(SECRET, "another-room-id", token)).toBeNull();
  });

  it("rejects a token minted with a different secret", async () => {
    const token = await mintRoleToken("some-other-secret", ROOM, "editor");
    expect(await verifyRoleToken(SECRET, ROOM, token)).toBeNull();
  });

  it("rejects a tampered MAC, including one edited to the same length", async () => {
    const token = await mintRoleToken(SECRET, ROOM, "viewer");
    const dot = token.indexOf(".");
    const flipped = token.slice(0, dot + 1) + (token[dot + 1] === "A" ? "B" : "A") + token.slice(dot + 2);
    expect(flipped).toHaveLength(token.length);
    expect(await verifyRoleToken(SECRET, ROOM, flipped)).toBeNull();
    expect(await verifyRoleToken(SECRET, ROOM, token.slice(0, -1))).toBeNull();
  });

  it("rejects a viewer token relabelled as an editor — the prefix is a claim, not a grant", async () => {
    const viewer = await mintRoleToken(SECRET, ROOM, "viewer");
    const promoted = `editor${viewer.slice(viewer.indexOf("."))}`;
    expect(await verifyRoleToken(SECRET, ROOM, promoted)).toBeNull();
  });

  it("rejects a malformed token without running any crypto on it", async () => {
    expect(await verifyRoleToken(SECRET, ROOM, "")).toBeNull();
    expect(await verifyRoleToken(SECRET, ROOM, "no-separator-here")).toBeNull();
    expect(await verifyRoleToken(SECRET, ROOM, "admin.whatever")).toBeNull();
    expect(await verifyRoleToken(SECRET, ROOM, ".")).toBeNull();
  });

  it("produces a URL-safe token — it travels as a query parameter", async () => {
    const token = await mintRoleToken(SECRET, ROOM, "editor");
    expect(token).toMatch(/^[\w.-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });
});
