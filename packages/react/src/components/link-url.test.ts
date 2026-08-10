import { describe, expect, it } from "vitest";
import { normalizeLinkUrl } from "./link-url";

describe("normalizeLinkUrl", () => {
  it("keeps a well-formed https URL", () => {
    expect(normalizeLinkUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("upgrades a bare host to https", () => {
    expect(normalizeLinkUrl("example.com")).toBe("https://example.com/");
  });

  it("accepts http", () => {
    expect(normalizeLinkUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it("rejects dangerous schemes (XSS vectors)", () => {
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects empty / whitespace", () => {
    expect(normalizeLinkUrl("")).toBeNull();
    expect(normalizeLinkUrl("   ")).toBeNull();
  });
});
