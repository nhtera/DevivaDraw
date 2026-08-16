import { describe, expect, it } from "vitest";
import { contentHash, decideOnModify, lastWrittenHash, recordWrittenContent } from "./external-change";

describe("decideOnModify", () => {
  it("suppresses the app's own save echo regardless of dirty state", () => {
    const hash = contentHash("saved-content");
    expect(decideOnModify({ changedHash: hash, lastWrittenHash: hash, dirty: false })).toBe("suppress");
    // Dirty can be true the instant after a save if an edit landed between write and event — the
    // echo is still the echo.
    expect(decideOnModify({ changedHash: hash, lastWrittenHash: hash, dirty: true })).toBe("suppress");
  });

  it("reloads a clean document on a genuinely external change", () => {
    expect(decideOnModify({ changedHash: "aaaa", lastWrittenHash: "bbbb", dirty: false })).toBe("reload");
    expect(decideOnModify({ changedHash: "aaaa", lastWrittenHash: null, dirty: false })).toBe("reload");
  });

  it("conflicts (never clobbers) when local edits are unsaved and the disk changed externally", () => {
    expect(decideOnModify({ changedHash: "aaaa", lastWrittenHash: "bbbb", dirty: true })).toBe("conflict");
    expect(decideOnModify({ changedHash: "aaaa", lastWrittenHash: null, dirty: true })).toBe("conflict");
  });
});

describe("contentHash / written-content registry", () => {
  it("hashes deterministically and distinguishes different content", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });

  it("round-trips through the per-path registry", () => {
    expect(lastWrittenHash("/tmp/none.devivadraw")).toBeNull();
    recordWrittenContent("/tmp/doc.devivadraw", "content-a");
    expect(lastWrittenHash("/tmp/doc.devivadraw")).toBe(contentHash("content-a"));
    recordWrittenContent("/tmp/doc.devivadraw", "content-b");
    expect(lastWrittenHash("/tmp/doc.devivadraw")).toBe(contentHash("content-b"));
  });
});
