import { describe, expect, it } from "vitest";
import { importExcalidrawLibrary } from "./excalidraw-library-import";

const RECT = { type: "rectangle", id: "r1", x: 0, y: 0, width: 10, height: 10 };
const TEXT = { type: "text", id: "t1", x: 0, y: 0, text: "hi" };

describe("importExcalidrawLibrary", () => {
  it("reads the v1 envelope, whose items are bare element arrays with no metadata", () => {
    const result = importExcalidrawLibrary({ type: "excalidrawlib", version: 1, library: [[RECT], [RECT, TEXT]] })!;

    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.name).toBeNull();
    expect(result.items[1]!.elements.map((element) => element.type)).toEqual(["rectangle", "text"]);
  });

  it("reads the v2 envelope and keeps the stored item name", () => {
    const result = importExcalidrawLibrary({
      type: "excalidrawlib",
      version: 2,
      libraryItems: [
        { id: "a", status: "published", name: "Database", elements: [RECT] },
        { id: "b", status: "unpublished", elements: [TEXT] },
      ],
    })!;

    expect(result.items.map((item) => item.name)).toEqual(["Database", null]);
  });

  it("distinguishes a non-library file from an empty one, so the caller can say which went wrong", () => {
    // `null` means "wrong file"; an empty `items` array means "a library that holds nothing".
    expect(importExcalidrawLibrary({ type: "excalidraw", elements: [RECT] })).toBeNull();
    expect(importExcalidrawLibrary([RECT])).toBeNull();
    expect(importExcalidrawLibrary("nonsense")).toBeNull();
    expect(importExcalidrawLibrary({ type: "excalidrawlib" })).toBeNull(); // neither items field present
    expect(importExcalidrawLibrary({ type: "excalidrawlib", library: [] })).toEqual({ items: [], skipped: {} });
  });

  it("drops items that convert to nothing — an empty tile would be unusable and un-previewable", () => {
    const result = importExcalidrawLibrary({ type: "excalidrawlib", library: [[{ type: "image", x: 0, y: 0 }], [RECT]] })!;
    expect(result.items).toHaveLength(1);
    expect(result.skipped).toEqual({ image: 1 });
  });

  it("sums skipped element counts across every item", () => {
    const image = { type: "image", x: 0, y: 0 };
    const result = importExcalidrawLibrary({ type: "excalidrawlib", library: [[RECT, image], [RECT, image, image]] })!;
    expect(result.skipped).toEqual({ image: 3 });
  });

  it("keeps each item's cross-references inside that item", () => {
    // Items are converted independently, so a binding pointing into a *different* item has no
    // referent and must be dropped rather than silently resolving against a stranger.
    const result = importExcalidrawLibrary({
      type: "excalidrawlib",
      library: [[RECT], [{ type: "arrow", id: "a1", x: 0, y: 0, points: [[0, 0], [5, 5]], endBinding: { elementId: "r1", focus: 0, gap: 1 } }]],
    })!;

    const arrow = result.items[1]!.elements[0]!;
    expect(arrow.type).toBe("arrow");
    expect(arrow.type === "arrow" && arrow.endBinding).toBeNull();
  });
});
