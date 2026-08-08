import { describe, expect, it } from "vitest";
import { buildShareUrl } from "./build-share-url";

describe("buildShareUrl", () => {
  it("builds the {origin}/s/{blobId}#key=...&iv=... shape", () => {
    const url = buildShareUrl({ origin: "https://draw.deviva.app", blobId: "abc-123", keyBase64Url: "KEY", ivBase64Url: "IV" });
    expect(url).toBe("https://draw.deviva.app/s/abc-123#key=KEY&iv=IV");
  });

  it("strips a trailing slash from origin", () => {
    const url = buildShareUrl({ origin: "https://draw.deviva.app/", blobId: "abc", keyBase64Url: "K", ivBase64Url: "I" });
    expect(url.startsWith("https://draw.deviva.app/s/abc")).toBe(true);
  });

  it("URL-encodes a blobId containing reserved characters", () => {
    const url = buildShareUrl({ origin: "https://draw.deviva.app", blobId: "a/b c", keyBase64Url: "K", ivBase64Url: "I" });
    expect(url).toContain("/s/a%2Fb%20c#");
  });

  it("never leaks the key/iv outside the fragment (everything after '#')", () => {
    const url = buildShareUrl({ origin: "https://draw.deviva.app", blobId: "abc", keyBase64Url: "SECRET_KEY", ivBase64Url: "SECRET_IV" });
    const [beforeFragment] = url.split("#");
    expect(beforeFragment).not.toContain("SECRET_KEY");
    expect(beforeFragment).not.toContain("SECRET_IV");
  });
});
