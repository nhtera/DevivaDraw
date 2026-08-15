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
