import { describe, expect, it } from "vitest";
import { isEmbeddable, resolveEmbed } from "./embed-providers";

describe("resolveEmbed", () => {
  it("maps a YouTube watch URL to its embed URL", () => {
    expect(resolveEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({ provider: "youtube", embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" });
  });

  it("maps a youtu.be short link", () => {
    expect(resolveEmbed("https://youtu.be/dQw4w9WgXcQ")?.embedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("maps a Vimeo URL", () => {
    expect(resolveEmbed("https://vimeo.com/123456789")).toEqual({ provider: "vimeo", embedUrl: "https://player.vimeo.com/video/123456789" });
  });

  it("wraps a Figma file through the official embed host", () => {
    const resolved = resolveEmbed("https://www.figma.com/file/abc/Design");
    expect(resolved?.provider).toBe("figma");
    expect(resolved?.embedUrl).toContain("figma.com/embed");
  });

  it("refuses a non-allowlisted host (no arbitrary iframes)", () => {
    expect(resolveEmbed("https://evil.example.com/page")).toBeNull();
    expect(isEmbeddable("https://example.com")).toBe(false);
  });

  it("refuses a dangerous scheme", () => {
    expect(resolveEmbed("javascript:alert(1)")).toBeNull();
  });
});
