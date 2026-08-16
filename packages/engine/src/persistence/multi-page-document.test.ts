import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import {
  deserializeMultiPageDocument,
  deserializeMultiPageDocumentLenient,
  MULTI_PAGE_DOCUMENT_TYPE,
  serializeMultiPageDocument,
} from "./multi-page-document";
import { restoreAutosaveDocument, writeAutosaveDocument } from "./local-storage-autosave";
import type { StorageLike } from "./local-storage-autosave";
import { serializeScene } from "./serialize-scene";

function sceneWithRect(x = 10): Scene {
  const scene = new Scene();
  scene.addElement(createRectangleElement({ x, y: 20, width: 30, height: 40 }));
  return scene;
}

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("serializeMultiPageDocument / deserializeMultiPageDocument round-trip", () => {
  it("round-trips two pages with names, order, and the active page", () => {
    const document = serializeMultiPageDocument(
      [
        { id: "p1", name: "Flow", scene: sceneWithRect(10) },
        { id: "p2", name: "Notes", scene: sceneWithRect(99) },
      ],
      { activePageId: "p2" },
    );

    const result = deserializeMultiPageDocument(JSON.parse(JSON.stringify(document)));
    if (!result.ok) throw new Error(result.error);
    expect(result.pages.map((page) => [page.id, page.name])).toEqual([
      ["p1", "Flow"],
      ["p2", "Notes"],
    ]);
    expect(result.activePageId).toBe("p2");
    expect(result.pages[1]!.scene.getElements()[0]!.x).toBe(99);
  });

  it("reads a legacy single-scene document as one page", () => {
    const legacy = serializeScene(sceneWithRect(5));
    const result = deserializeMultiPageDocument(JSON.parse(JSON.stringify(legacy)));
    if (!result.ok) throw new Error(result.error);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.scene.getElements()[0]!.x).toBe(5);
    expect(result.activePageId).toBeNull();
  });

  it("strict mode fails the whole document on one broken page", () => {
    const document = serializeMultiPageDocument([{ id: "p1", name: "Flow", scene: sceneWithRect() }]) as unknown as Record<string, unknown>;
    (document.pages as unknown[]).push({ id: "p2", name: "Broken", scene: { type: "wrong" } });
    expect(deserializeMultiPageDocument(document).ok).toBe(false);
  });

  it("rejects an unknown envelope and an unsupported document version", () => {
    expect(deserializeMultiPageDocument({ type: "other/thing" }).ok).toBe(false);
    expect(deserializeMultiPageDocument({ type: MULTI_PAGE_DOCUMENT_TYPE, schemaVersion: 99, pages: [] }).ok).toBe(false);
  });
});

describe("deserializeMultiPageDocumentLenient", () => {
  it("drops a broken page entry and keeps the rest, reporting what fell", () => {
    const document = serializeMultiPageDocument([
      { id: "p1", name: "Good", scene: sceneWithRect() },
      { id: "p2", name: "AlsoGood", scene: sceneWithRect() },
    ]) as unknown as Record<string, unknown>;
    (document.pages as unknown[]).splice(1, 0, "not an object", { id: "p1", name: "Dup", scene: serializeScene(sceneWithRect()) });

    const result = deserializeMultiPageDocumentLenient(document);
    if (!result.ok) throw new Error(result.error);
    expect(result.pages.map((page) => page.id)).toEqual(["p1", "p2"]);
    expect(result.droppedErrors.some((message) => message.includes("must be an object"))).toBe(true);
    expect(result.droppedErrors.some((message) => message.includes("duplicate page id"))).toBe(true);
  });

  it("salvages inside a page too — an invalid element drops, the page survives", () => {
    const document = serializeMultiPageDocument([{ id: "p1", name: "Flow", scene: sceneWithRect() }]) as unknown as {
      pages: Array<{ scene: { elements: unknown[] } }>;
    };
    document.pages[0]!.scene.elements.push({ type: "rectangle", id: 42 });

    const result = deserializeMultiPageDocumentLenient(document);
    if (!result.ok) throw new Error("expected salvage");
    expect(result.pages[0]!.scene.getElements()).toHaveLength(1);
    expect(result.droppedErrors.length).toBeGreaterThan(0);
  });

  it("fails only when no page is readable", () => {
    const result = deserializeMultiPageDocumentLenient({ type: MULTI_PAGE_DOCUMENT_TYPE, schemaVersion: 1, pages: ["junk"] });
    expect(result.ok).toBe(false);
  });
});

describe("document autosave", () => {
  it("write + restore round-trips pages, and restores a legacy scene autosave as one page", () => {
    const storage = memoryStorage();
    writeAutosaveDocument(storage, serializeMultiPageDocument([{ id: "p1", name: "Flow", scene: sceneWithRect(7) }], { activePageId: "p1" }));
    const restored = restoreAutosaveDocument(storage);
    expect(restored?.pages[0]!.scene.getElements()[0]!.x).toBe(7);
    expect(restored?.activePageId).toBe("p1");

    const legacyStorage = memoryStorage();
    legacyStorage.setItem("devivadraw:autosave:v1", JSON.stringify(serializeScene(sceneWithRect(3), { includeDeleted: true })));
    const legacy = restoreAutosaveDocument(legacyStorage);
    expect(legacy?.pages).toHaveLength(1);
    expect(legacy?.pages[0]!.scene.getElements()[0]!.x).toBe(3);
  });

  it("backs a salvaged document up to the recovery slot, same contract as the scene restore", () => {
    const storage = memoryStorage();
    const document = serializeMultiPageDocument([{ id: "p1", name: "Flow", scene: sceneWithRect() }]) as unknown as {
      pages: Array<{ scene: { elements: unknown[] } }>;
    };
    document.pages[0]!.scene.elements.push({ broken: true });
    const raw = JSON.stringify(document);
    storage.setItem("devivadraw:autosave:v1", raw);

    let salvageInfo: { droppedErrors: string[]; backedUp: boolean } | null = null;
    const restored = restoreAutosaveDocument(storage, undefined, { onSalvage: (info) => (salvageInfo = info) });
    expect(restored?.pages).toHaveLength(1);
    expect(salvageInfo!.backedUp).toBe(true);
    expect(storage.getItem("devivadraw:autosave:v1:recovery")).toBe(raw);
  });
});

describe("per-page camera round-trip", () => {
  it("round-trips each page's camera through serialize → JSON → deserialize (both strictness levels)", () => {
    const document = serializeMultiPageDocument(
      [
        { id: "p1", name: "Flow", scene: sceneWithRect(10), camera: { scrollX: -120.5, scrollY: 300, zoom: 2.5 } },
        { id: "p2", name: "Notes", scene: sceneWithRect(99), camera: null },
      ],
      { activePageId: "p1" },
    );
    const raw = JSON.parse(JSON.stringify(document));

    const strict = deserializeMultiPageDocument(raw);
    if (!strict.ok) throw new Error(strict.error);
    expect(strict.pages[0]!.camera).toEqual({ scrollX: -120.5, scrollY: 300, zoom: 2.5 });
    expect(strict.pages[1]!.camera).toBeNull();

    const lenient = deserializeMultiPageDocumentLenient(raw);
    if (!lenient.ok) throw new Error(lenient.error);
    expect(lenient.pages[0]!.camera).toEqual({ scrollX: -120.5, scrollY: 300, zoom: 2.5 });
  });

  it("reads a legacy single-scene document's appState camera onto its one page", () => {
    const scene = serializeScene(sceneWithRect(), { appState: { scrollX: 5, scrollY: -7, zoom: 0.5 } });
    const result = deserializeMultiPageDocument(JSON.parse(JSON.stringify(scene)));
    if (!result.ok) throw new Error(result.error);
    expect(result.pages[0]!.camera).toEqual({ scrollX: 5, scrollY: -7, zoom: 0.5 });
  });

  it("yields a null camera for documents without one and refuses partial or unusable cameras", () => {
    const noCamera = serializeMultiPageDocument([{ id: "p1", name: "Flow", scene: sceneWithRect() }]);
    const plain = deserializeMultiPageDocument(JSON.parse(JSON.stringify(noCamera)));
    if (!plain.ok) throw new Error(plain.error);
    expect(plain.pages[0]!.camera).toBeNull();

    // A hand-edited file with only some fields, or a zoom that can't render, restores nothing
    // rather than guessing at a viewport.
    const partial = JSON.parse(JSON.stringify(noCamera)) as { pages: { scene: { appState?: unknown } }[] };
    partial.pages[0]!.scene.appState = { scrollX: 1, scrollY: 2 };
    const partialResult = deserializeMultiPageDocument(partial);
    if (!partialResult.ok) throw new Error(partialResult.error);
    expect(partialResult.pages[0]!.camera).toBeNull();
  });

  it("clamps an out-of-range zoom to the product limits instead of restoring it verbatim", () => {
    const wild = serializeMultiPageDocument([{ id: "p1", name: "Flow", scene: sceneWithRect(), camera: { scrollX: 0, scrollY: 0, zoom: 9999 } }]);
    const result = deserializeMultiPageDocument(JSON.parse(JSON.stringify(wild)));
    if (!result.ok) throw new Error(result.error);
    expect(result.pages[0]!.camera!.zoom).toBe(30);
  });
});

// Hostile-document ceilings (offline-desktop plan phase 3) — shared by strict and lenient readers.
describe("multi-page bomb ceilings", () => {
  const emptyScene = () => serializeScene(new Scene());

  it("rejects a document over the page-count ceiling", () => {
    const pages = Array.from({ length: 501 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, scene: emptyScene() }));
    const result = deserializeMultiPageDocument({ type: "devivadraw/document", schemaVersion: 1, pages });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/page.*ceiling/i);
  });

  it("rejects a document whose element total across pages exceeds the ceiling, on both readers", () => {
    const scene = { ...emptyScene(), elements: new Array(60_000).fill(0) };
    const doc = { type: "devivadraw/document", schemaVersion: 1, pages: [
      { id: "a", name: "A", scene },
      { id: "b", name: "B", scene },
    ] };
    expect(deserializeMultiPageDocument(doc).ok).toBe(false);
    expect(deserializeMultiPageDocumentLenient(doc).ok).toBe(false);
  });
});
