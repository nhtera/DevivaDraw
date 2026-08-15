import { describe, expect, it, vi } from "vitest";
import { importDroppedFileText } from "./import-dropped-file";

/** Stands in for the real canvas rasterizer, which needs a DOM this suite's `node` environment lacks. */
const renderPreview = vi.fn(async () => "data:image/png;base64,preview");

const EXCALIDRAW_SCENE = {
  type: "excalidraw",
  version: 2,
  elements: [{ type: "rectangle", id: "r1", x: 0, y: 0, width: 10, height: 10 }],
  appState: { viewBackgroundColor: "#ffffff" },
};

const EXCALIDRAW_LIBRARY = {
  type: "excalidrawlib",
  version: 2,
  libraryItems: [{ id: "x1", status: "published", name: "Database", elements: [{ type: "rectangle", id: "r1", x: 0, y: 0, width: 10, height: 10 }] }],
};

const NATIVE_LIBRARY = [{ id: "n1", name: "Saved", elements: [{ type: "rectangle", id: "r", x: 0, y: 0 }], preview: "data:image/png;base64,stored", created: 0 }];

describe("importDroppedFileText", () => {
  it("reads an Excalidraw scene as a whole document", async () => {
    const imported = await importDroppedFileText(JSON.stringify(EXCALIDRAW_SCENE), renderPreview);
    expect(imported.kind).toBe("scene");
    if (imported.kind !== "scene") return;
    expect(imported.document.pages).toHaveLength(1);
    expect(imported.document.pages[0]!.scene.getElements()).toHaveLength(1);
  });

  it("reads an .excalidrawlib as library items, not as a scene that would replace the document", async () => {
    const imported = await importDroppedFileText(JSON.stringify(EXCALIDRAW_LIBRARY), renderPreview);
    expect(imported.kind).toBe("library");
    if (imported.kind !== "library") return;
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0]!.name).toBe("Database");
  });

  it("reads this app's own .devivalib the same way", async () => {
    const imported = await importDroppedFileText(JSON.stringify(NATIVE_LIBRARY), renderPreview);
    expect(imported.kind).toBe("library");
  });

  it("reports anything else instead of guessing — a wrong guess here would replace the drawing", async () => {
    expect((await importDroppedFileText("not json at all", renderPreview)).kind).toBe("unsupported");
    expect((await importDroppedFileText(JSON.stringify({ type: "something-else" }), renderPreview)).kind).toBe("unsupported");
  });
});
