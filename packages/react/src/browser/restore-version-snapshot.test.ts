/**
 * The restore sequence, and every way it is allowed to refuse.
 *
 * Two properties carry the weight. **The guard runs before anything is read**, so no entry point can
 * reach a document swap during a session by any route. And **a bad record changes nothing** — the
 * board the user is looking at survives a version that will not deserialise, rather than being
 * emptied first and repaired never.
 */
import { describe, expect, it, vi } from "vitest";
import { createImageElement, Scene, serializeMultiPageDocument } from "@deviva-draw/engine";
import { PageStore } from "../pages/page-store";
import type { FileStoreLike, MultiPageDocumentV1, StoredFile } from "@deviva-draw/engine";
import { restoreVersionSnapshot } from "./restore-version-snapshot";
import type { RestoreVersionDeps } from "./restore-version-snapshot";
import type { VersionStore } from "./indexeddb-version-store";
import type { VersionSnapshot } from "./version-snapshot-types";

const PNG: StoredFile = { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", createdAt: 1 };

/** A stored document of `pageCount` pages, the last of which carries an image referenced by id only. */
function storedDocument(pageCount: number, fileId?: string): MultiPageDocumentV1 {
  const pages = Array.from({ length: pageCount }, (_unused, index) => {
    const scene = new Scene();
    if (fileId && index === pageCount - 1) scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, naturalWidth: 10, naturalHeight: 10, fileId }));
    return { id: `stored-${index}`, name: `Stored ${index + 1}`, scene, camera: null };
  });
  return serializeMultiPageDocument(pages, { includeDeleted: true, excludeFileIds: fileId ? new Set([fileId]) : undefined });
}

function snapshot(document: MultiPageDocumentV1, fileIds: string[] = []): VersionSnapshot {
  return { id: "v1", createdAt: 1, trigger: "manual", label: "a version", pageCount: document.pages.length, elementCount: 0, bytes: 1, fileIds, document };
}

function versionStore(stored: VersionSnapshot | null): VersionStore {
  return {
    list: () => Promise.resolve([]),
    get: (id) => Promise.resolve(stored && stored.id === id ? stored : null),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    clearAll: () => Promise.resolve(),
    referencedFileIds: () => Promise.resolve(new Set()),
  };
}

function fileStore(held: Record<string, StoredFile> = {}): FileStoreLike {
  const data = new Map(Object.entries(held));
  return {
    getMany: (ids) => Promise.resolve(new Map(ids.flatMap((id) => (data.has(id) ? [[id, data.get(id)!] as const] : [])))),
    putMany: () => Promise.resolve(),
    deleteMany: () => Promise.resolve(),
    listIds: () => Promise.resolve([...data.keys()]),
  };
}

function harness(overrides: Partial<RestoreVersionDeps> = {}) {
  const pageStore = PageStore.fresh();
  const snapshotBeforeRestore = vi.fn(() => Promise.resolve(null));
  const onRestored = vi.fn();
  const deps: RestoreVersionDeps = {
    versionStore: versionStore(snapshot(storedDocument(3))),
    fileStore: fileStore(),
    pageStore,
    isSessionActive: () => false,
    snapshotBeforeRestore,
    onRestored,
    ...overrides,
  };
  return { deps, pageStore, snapshotBeforeRestore, onRestored };
}

describe("restoreVersionSnapshot", () => {
  it("replaces the whole document and reports how many pages it put back", async () => {
    const { deps, pageStore, onRestored } = harness();

    const outcome = await restoreVersionSnapshot("v1", deps);

    expect(outcome).toEqual({ ok: true, pageCount: 3 });
    expect(pageStore.getPages().map((page) => page.name)).toEqual(["Stored 1", "Stored 2", "Stored 3"]);
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("takes the way back before taking the way forward", async () => {
    const order: string[] = [];
    const pageStore = PageStore.fresh();
    const original = pageStore.replaceAll.bind(pageStore);
    pageStore.replaceAll = (pages, activeId) => {
      order.push("replaced");
      original(pages, activeId);
    };
    const { deps } = harness({
      pageStore,
      snapshotBeforeRestore: () => {
        order.push("snapshotted");
        return Promise.resolve(null);
      },
    });

    await restoreVersionSnapshot("v1", deps);

    expect(order).toEqual(["snapshotted", "replaced"]);
  });

  it("refuses while a session is connected, without reading or writing anything", async () => {
    const { deps, pageStore, snapshotBeforeRestore, onRestored } = harness({ isSessionActive: () => true });
    const before = pageStore.getPages();

    const outcome = await restoreVersionSnapshot("v1", deps);

    expect(outcome).toEqual({ ok: false, reason: "in-session" });
    expect(pageStore.getPages()).toEqual(before);
    expect(snapshotBeforeRestore).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("refuses just as firmly while a join is still connecting", async () => {
    // The connecting window reports nothing through `status`/`roomUrl`; only the `joining` flag this
    // callback reads knows about it, which is the whole reason it is a callback.
    let connecting = true;
    const { deps, pageStore } = harness({ isSessionActive: () => connecting });
    const before = pageStore.getPages();

    expect(await restoreVersionSnapshot("v1", deps)).toEqual({ ok: false, reason: "in-session" });
    expect(pageStore.getPages()).toEqual(before);

    connecting = false;
    expect(await restoreVersionSnapshot("v1", deps)).toMatchObject({ ok: true });
  });

  it("asks whether a session is active at the moment of the attempt, not once at setup", async () => {
    const isSessionActive = vi.fn(() => false);
    const { deps } = harness({ isSessionActive });

    await restoreVersionSnapshot("v1", deps);
    await restoreVersionSnapshot("v1", deps);

    expect(isSessionActive).toHaveBeenCalledTimes(2);
  });

  it("reports a version that is no longer there — deleted by retention, or by another tab", async () => {
    const { deps, pageStore } = harness({ versionStore: versionStore(null) });
    const before = pageStore.getPages();

    expect(await restoreVersionSnapshot("gone", deps)).toEqual({ ok: false, reason: "not-found" });
    expect(pageStore.getPages()).toEqual(before);
  });

  it("leaves the open document completely untouched when the record will not deserialise", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const corrupt = { type: "devivadraw/document", schemaVersion: 1, pages: [{ id: "p", name: "P", scene: { nonsense: true } }] } as unknown as MultiPageDocumentV1;
    const { deps, pageStore, snapshotBeforeRestore, onRestored } = harness({ versionStore: versionStore(snapshot(corrupt)) });
    const before = pageStore.getPages();

    expect(await restoreVersionSnapshot("v1", deps)).toEqual({ ok: false, reason: "unreadable" });

    // Not half-swapped, not emptied — the same board, and no milestone spent on a restore that never
    // happened.
    expect(pageStore.getPages()).toEqual(before);
    expect(snapshotBeforeRestore).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reports that there is no version history at all rather than pretending to try", async () => {
    const { deps } = harness({ versionStore: null });

    expect(await restoreVersionSnapshot("v1", deps)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("puts the restored document's images back into their scenes", async () => {
    const { deps, pageStore } = harness({
      versionStore: versionStore(snapshot(storedDocument(2, "file-a"), ["file-a"])),
      fileStore: fileStore({ "file-a": PNG }),
    });

    await restoreVersionSnapshot("v1", deps);

    // The document stored the reference only; without this the page renders a broken-image box.
    const restored = pageStore.getScenes().at(-1)!;
    expect(restored.hasFile("file-a")).toBe(true);
  });

  it("still restores the document when there is no file store to rehydrate from", async () => {
    const { deps, pageStore } = harness({ versionStore: versionStore(snapshot(storedDocument(2, "file-a"), ["file-a"])), fileStore: null });

    expect(await restoreVersionSnapshot("v1", deps)).toMatchObject({ ok: true, pageCount: 2 });
    expect(pageStore.getPages()).toHaveLength(2);
  });
});
