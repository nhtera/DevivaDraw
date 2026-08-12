import { describe, expect, it, vi } from "vitest";
import { parseLibraryFile } from "./library-import";

/** Stands in for the real canvas rasterizer, which needs a DOM this suite's `node` environment lacks. */
const renderPreview = vi.fn(async () => "data:image/png;base64,preview");

const NATIVE_LIBRARY = [
  { id: "n1", name: "Saved", elements: [{ type: "rectangle", id: "r", x: 0, y: 0 }], preview: "data:image/png;base64,stored", created: 0 },
];

const EXCALIDRAW_LIBRARY = {
  type: "excalidrawlib",
  version: 2,
  libraryItems: [{ id: "x1", status: "published", name: "Database", elements: [{ type: "cylinder", x: 0, y: 0 }, { type: "rectangle", id: "r1", x: 0, y: 0, width: 10, height: 10 }] }],
};

describe("parseLibraryFile", () => {
  it("passes a native .devivalib through untouched, keeping its stored previews", async () => {
    const result = await parseLibraryFile(JSON.stringify(NATIVE_LIBRARY), renderPreview);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.items[0]!.preview).toBe("data:image/png;base64,stored");
    expect(result.skipped).toEqual({});
  });

  it("converts an .excalidrawlib and renders a preview per item, since that format stores none", async () => {
    renderPreview.mockClear();
    const result = await parseLibraryFile(JSON.stringify(EXCALIDRAW_LIBRARY), renderPreview);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.name).toBe("Database");
    expect(result.items[0]!.preview).toBe("data:image/png;base64,preview");
    expect(renderPreview).toHaveBeenCalledTimes(1);
    // `cylinder` is an Excalidraw shape with no equivalent here — reported, not silently dropped.
    expect(result.skipped).toEqual({ cylinder: 1 });
  });

  it("detects the format by content, so a renamed file still imports", async () => {
    // Neither branch ever looks at the extension — the panel passes only the file's text.
    const result = await parseLibraryFile(JSON.stringify({ ...EXCALIDRAW_LIBRARY, source: "https://excalidraw.com" }), renderPreview);
    expect("error" in result).toBe(false);
  });

  it("mints a fresh id per imported item so a re-import never collides with what is already stored", async () => {
    const twoItems = { type: "excalidrawlib", library: [[{ type: "rectangle", x: 0, y: 0 }], [{ type: "ellipse", x: 0, y: 0 }]] };
    const first = await parseLibraryFile(JSON.stringify(twoItems), renderPreview);
    const second = await parseLibraryFile(JSON.stringify(twoItems), renderPreview);

    if ("error" in first || "error" in second) throw new Error("expected both to parse");
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("tells malformed JSON apart from a well-formed file of the wrong kind", async () => {
    expect(await parseLibraryFile("{not json", renderPreview)).toEqual({ error: "invalid-json" });
    // A valid `.excalidraw` *scene* is well-formed JSON but is not a library.
    expect(await parseLibraryFile(JSON.stringify({ type: "excalidraw", elements: [] }), renderPreview)).toEqual({ error: "unrecognized" });
  });
});
