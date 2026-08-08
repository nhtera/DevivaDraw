import { describe, expect, it } from "vitest";
import { buildShareUrl } from "./build-share-url";
import { parseShareUrl } from "./parse-share-url";

describe("parseShareUrl", () => {
  it("parses a well-formed share URL's path + fragment", () => {
    const result = parseShareUrl("/s/abc-123", "#key=KEY&iv=IV");
    expect(result).toEqual({ ok: true, value: { blobId: "abc-123", keyBase64Url: "KEY", ivBase64Url: "IV" } });
  });

  it("is the exact inverse of buildShareUrl for a round trip", () => {
    const url = new URL(buildShareUrl({ origin: "https://draw.deviva.app", blobId: "xyz-789", keyBase64Url: "MyKeyValue", ivBase64Url: "MyIvValue" }));
    const result = parseShareUrl(url.pathname, url.hash);
    expect(result).toEqual({ ok: true, value: { blobId: "xyz-789", keyBase64Url: "MyKeyValue", ivBase64Url: "MyIvValue" } });
  });

  it("accepts a fragment without a leading '#'", () => {
    const result = parseShareUrl("/s/abc", "key=K&iv=I");
    expect(result).toEqual({ ok: true, value: { blobId: "abc", keyBase64Url: "K", ivBase64Url: "I" } });
  });

  it.each([
    ["/wrong-path/abc", "#key=K&iv=I", "invalid-path"],
    ["/s/", "#key=K&iv=I", "invalid-path"],
    ["", "#key=K&iv=I", "invalid-path"],
    ["/s/abc/extra/segments", "#key=K&iv=I", "invalid-path"],
  ] as const)("rejects a malformed path %s with reason %s", (pathname, fragment, expectedReason) => {
    const result = parseShareUrl(pathname, fragment);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(expectedReason);
  });

  it.each([
    ["/s/abc", "", "missing-key-material"],
    ["/s/abc", "#key=K", "missing-key-material"],
    ["/s/abc", "#iv=I", "missing-key-material"],
    ["/s/abc", "#key=&iv=I", "missing-key-material"],
    ["/s/abc", "#totally-unrelated-fragment", "missing-key-material"],
  ] as const)("rejects a fragment missing key/iv %s with reason %s", (pathname, fragment, expectedReason) => {
    const result = parseShareUrl(pathname, fragment);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(expectedReason);
  });

  it("never throws on hostile/garbage input", () => {
    const hostileInputs: Array<[string, string]> = [
      ["/s/" + "x".repeat(10_000), "#key=K&iv=I"],
      ["/s/<script>alert(1)</script>", "#key=K&iv=I"],
      ["/s/abc", "#key=%zz&iv=%zz"],
      ["../../etc/passwd", "#key=K&iv=I"],
    ];
    for (const [pathname, fragment] of hostileInputs) {
      expect(() => parseShareUrl(pathname, fragment)).not.toThrow();
    }
  });
});
