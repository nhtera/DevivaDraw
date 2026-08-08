import { describe, expect, it } from "vitest";
import { findFirstImageItem, isImageMimeType, looksLikeSvgMarkup, shouldConsumePaste, svgMarkupToBytes } from "./clipboard-image-detection";

describe("isImageMimeType", () => {
  it("is true for image/* mime types, including svg", () => {
    expect(isImageMimeType("image/png")).toBe(true);
    expect(isImageMimeType("image/jpeg")).toBe(true);
    expect(isImageMimeType("image/svg+xml")).toBe(true);
  });

  it("is false for non-image mime types", () => {
    expect(isImageMimeType("text/plain")).toBe(false);
    expect(isImageMimeType("application/json")).toBe(false);
    expect(isImageMimeType("")).toBe(false);
  });
});

describe("looksLikeSvgMarkup", () => {
  it("detects a bare <svg> root tag", () => {
    expect(looksLikeSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBe(true);
  });

  it("detects an svg preceded by an XML prolog", () => {
    expect(looksLikeSvgMarkup('<?xml version="1.0"?>\n<svg><rect/></svg>')).toBe(true);
  });

  it("is false for ordinary prose text", () => {
    expect(looksLikeSvgMarkup("just some pasted text, no markup here")).toBe(false);
  });

  it("is false for unrelated markup (e.g. pasted HTML) that doesn't contain <svg", () => {
    expect(looksLikeSvgMarkup("<div>hello</div>")).toBe(false);
  });

  it("is false for the empty string", () => {
    expect(looksLikeSvgMarkup("")).toBe(false);
  });
});

describe("svgMarkupToBytes", () => {
  it("encodes SVG text as UTF-8 bytes decodable back to the same string", () => {
    const svg = "<svg><text>héllo</text></svg>"; // includes a non-ASCII char to exercise UTF-8 encoding
    const bytes = svgMarkupToBytes(svg);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe(svg);
  });
});

describe("shouldConsumePaste", () => {
  it("never consumes while a real <textarea> is focused, regardless of clipboard content (the SVG-paste-into-textarea bug)", () => {
    expect(shouldConsumePaste("TEXTAREA", false, ["text-plain"])).toBe(false);
    expect(shouldConsumePaste("TEXTAREA", false, ["svg-mime"])).toBe(false);
    expect(shouldConsumePaste("TEXTAREA", false, ["file"])).toBe(false);
  });

  it("never consumes while a real <input> is focused", () => {
    expect(shouldConsumePaste("INPUT", false, ["file"])).toBe(false);
  });

  it("never consumes while any contenteditable element is focused, regardless of its tag name", () => {
    expect(shouldConsumePaste("DIV", true, ["file"])).toBe(false);
  });

  it("consumes an image file when the canvas (non-editable target) has focus", () => {
    expect(shouldConsumePaste(null, false, ["file"])).toBe(true);
    expect(shouldConsumePaste("BODY", false, ["file"])).toBe(true);
  });

  it("consumes SVG-flavored or plain-text-candidate clipboard content when the canvas has focus", () => {
    expect(shouldConsumePaste(null, false, ["svg-mime"])).toBe(true);
    expect(shouldConsumePaste(null, false, ["text-plain"])).toBe(true);
  });

  it("does not consume when the target is non-editable but there is nothing image-worthy on the clipboard", () => {
    expect(shouldConsumePaste(null, false, [])).toBe(false);
  });
});

describe("findFirstImageItem", () => {
  it("returns the first item whose type is an image mime type", () => {
    const items = [{ type: "text/plain" }, { type: "image/png" }, { type: "image/jpeg" }];
    expect(findFirstImageItem(items)).toBe(items[1]);
  });

  it("returns undefined when no item is an image", () => {
    expect(findFirstImageItem([{ type: "text/plain" }, { type: "text/html" }])).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(findFirstImageItem([])).toBeUndefined();
  });
});
