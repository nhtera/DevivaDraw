import { describe, expect, it } from "vitest";
import type { AnyElement } from "@deviva-draw/engine";
import { deriveLibraryItemName, libraryItemMatches, libraryItemTexts } from "./library-item-name";
import type { LibraryItem } from "./library-storage";

/** A text element, cut down to the fields naming reads. */
function text(content: string, fontSize = 16, extra: Partial<AnyElement> = {}): AnyElement {
  return { id: content, type: "text", text: content, fontSize, isDeleted: false, ...extra } as unknown as AnyElement;
}

const rect = { id: "r", type: "rectangle", isDeleted: false } as unknown as AnyElement;

function item(name: string, elements: AnyElement[]): LibraryItem {
  return { id: name, name, elements, preview: "", created: 0 };
}

describe("deriveLibraryItemName", () => {
  it("names an item after its largest label, not the first one it happens to reach", () => {
    // The shape of a real annotated item: a small caption under a big heading.
    expect(deriveLibraryItemName([text("www 127.0.0.1", 10), text("DNS", 26)], "Item 1")).toBe("DNS");
  });

  it("ignores decoration that is set larger than the label it decorates", () => {
    // Straight from a published library: 29px braces around an 18px "Document DB".
    expect(deriveLibraryItemName([text("{", 29), text("}", 29), text("Document DB", 18)], "Item 1")).toBe("Document DB");
  });

  it("flattens the line breaks a wrapped label stores", () => {
    expect(deriveLibraryItemName([text("Load\nBalancer", 20)], "Item 1")).toBe("Load Balancer");
  });

  it("keeps document order when labels are the same size", () => {
    expect(deriveLibraryItemName([text("First", 16), text("Second", 16)], "Item 1")).toBe("First");
  });

  it("falls back for a pure shape, which has nothing to be named after", () => {
    expect(deriveLibraryItemName([rect], "Item 4")).toBe("Item 4");
    expect(deriveLibraryItemName([], "Item 4")).toBe("Item 4");
    // Whitespace-only and punctuation-only text is no more of a name than no text at all.
    expect(deriveLibraryItemName([text("   ", 20), text("—", 30)], "Item 4")).toBe("Item 4");
  });

  it("truncates a label that is a paragraph rather than a name, at a word boundary", () => {
    const name = deriveLibraryItemName([text("Lorem ipsum dolor sit amet, consectetur adipiscing elit", 20)], "Item 1");
    expect(name).toBe("Lorem ipsum dolor sit amet,…");
    expect(name.length).toBeLessThanOrEqual(32);
  });

  it("hard-cuts a single word with no boundary to break at", () => {
    expect(deriveLibraryItemName([text("A".repeat(50), 20)], "Item 1")).toBe(`${"A".repeat(31)}…`);
  });

  it("skips deleted text, which is not part of what the item draws", () => {
    expect(deriveLibraryItemName([text("Gone", 40, { isDeleted: true }), text("Kept", 12)], "Item 1")).toBe("Kept");
  });
});

describe("libraryItemMatches", () => {
  const cache = item("Cache", [text("Cache", 22), text("Key", 6), text("Value", 6)]);

  it("matches the name", () => {
    expect(libraryItemMatches(cache, "cach")).toBe(true);
  });

  it("matches a label the name did not win", () => {
    // The whole point: "Key" is inside the item but is not its name, and typing it must still find it.
    expect(libraryItemMatches(cache, "value")).toBe(true);
  });

  it("matches an unnamed imported item by its content", () => {
    // What a v1 `.excalidrawlib` produces before naming: a positional placeholder over real labels.
    const unnamed = item("Item 7", [text("Relational DB", 18)]);
    expect(libraryItemMatches(unnamed, "relational")).toBe(true);
    expect(libraryItemMatches(unnamed, "postgres")).toBe(false);
  });

  it("does not match an unrelated needle, and an empty needle matches everything", () => {
    expect(libraryItemMatches(cache, "nothing matches this")).toBe(false);
    expect(libraryItemMatches(cache, "")).toBe(true);
  });
});

describe("libraryItemTexts", () => {
  it("returns every usable label in document order and drops the rest", () => {
    expect(libraryItemTexts([text("One"), rect, text("  "), text("{"), text("Two\nlines")])).toEqual(["One", "Two lines"]);
  });
});
