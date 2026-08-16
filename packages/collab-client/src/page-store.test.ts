import { describe, expect, it, vi } from "vitest";
import { Scene } from "@deviva-draw/engine";
import { PageStore } from "./page-store";

describe("PageStore", () => {
  it("adds a page, switches to it, and keeps each page's scene isolated", () => {
    const store = PageStore.fresh();
    const firstScene = store.getActiveScene();
    const listener = vi.fn();
    store.subscribe(listener);

    const newId = store.addPage();
    expect(store.getActivePageId()).toBe(newId);
    expect(store.getActiveScene()).not.toBe(firstScene);
    expect(store.getPages().map((page) => page.name)).toEqual(["Page 1", "Page 2"]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("renames with trimming, ignoring empty or unchanged names", () => {
    const store = PageStore.fresh();
    const id = store.getActivePageId();
    const listener = vi.fn();
    store.subscribe(listener);

    store.renamePage(id, "  Flows  ");
    expect(store.getPages()[0]!.name).toBe("Flows");
    store.renamePage(id, "   ");
    store.renamePage(id, "Flows");
    expect(listener).toHaveBeenCalledTimes(1); // only the real rename notified
  });

  it("refuses to remove the last page, and activates the neighbor when the active one goes", () => {
    const store = PageStore.fresh();
    const first = store.getActivePageId();
    expect(store.removePage(first)).toBe(false);

    const second = store.addPage();
    expect(store.removePage(second)).toBe(true);
    expect(store.getActivePageId()).toBe(first);
    expect(store.getPages()).toHaveLength(1);
  });

  it("parks and restores per-page cameras", () => {
    const store = PageStore.fresh();
    const id = store.getActivePageId();
    store.saveCameraFor(id, { scrollX: 10, scrollY: 20, zoom: 2 });
    expect(store.cameraFor(id)).toEqual({ scrollX: 10, scrollY: 20, zoom: 2 });
    expect(store.cameraFor("missing")).toBeNull();
  });

  it("replaceAll swaps the whole document and resolves a stale active id to the first page", () => {
    const store = PageStore.fresh();
    store.replaceAll(
      [
        { id: "a", name: "A", scene: new Scene() },
        { id: "b", name: "B", scene: new Scene() },
      ],
      "nope",
    );
    expect(store.getActivePageId()).toBe("a");
    expect(store.getPages().map((page) => page.id)).toEqual(["a", "b"]);
  });

  it("serializes to a document that names the active page", () => {
    const store = PageStore.fresh();
    store.addPage("Second");
    const document = store.toDocument(true);
    expect(document.type).toBe("devivadraw/document");
    expect(document.pages.map((page) => page.name)).toEqual(["Page 1", "Second"]);
    expect(document.activePageId).toBe(store.getActivePageId());
  });

  it("seeds parked cameras from incoming pages in the constructor and replaceAll", () => {
    const camera = { scrollX: -50, scrollY: 75, zoom: 1.5 };
    const store = new PageStore([{ id: "a", name: "A", scene: new Scene(), camera }], "a");
    expect(store.cameraFor("a")).toEqual(camera);

    store.replaceAll(
      [
        { id: "b", name: "B", scene: new Scene(), camera: { scrollX: 1, scrollY: 2, zoom: 3 } },
        { id: "c", name: "C", scene: new Scene() },
      ],
      "b",
    );
    expect(store.cameraFor("b")).toEqual({ scrollX: 1, scrollY: 2, zoom: 3 });
    expect(store.cameraFor("c")).toBeNull();
  });

  it("toDocument parks the provided live camera on the active page and serializes every parked camera", () => {
    const store = new PageStore(
      [
        { id: "a", name: "A", scene: new Scene(), camera: { scrollX: 9, scrollY: 9, zoom: 1 } },
        { id: "b", name: "B", scene: new Scene() },
      ],
      "b",
    );
    const live = { scrollX: 400, scrollY: -300, zoom: 0.5 };
    const document = store.toDocument(false, live);

    expect(document.pages[0]!.scene.appState).toMatchObject({ scrollX: 9, scrollY: 9, zoom: 1 });
    expect(document.pages[1]!.scene.appState).toMatchObject({ scrollX: 400, scrollY: -300, zoom: 0.5 });
    // The live camera was parked, not just serialized — the store reads it back afterward.
    expect(store.cameraFor("b")).toEqual(live);

    // Without a live camera the never-visited page stays camera-less in the output.
    const fresh = new PageStore([{ id: "x", name: "X", scene: new Scene() }], "x");
    expect(fresh.toDocument(false).pages[0]!.scene.appState).toBeUndefined();
  });
});

describe("PageStore collab manifest", () => {
  it("bumps the manifest on page operations but not on switching or camera parking", () => {
    const store = PageStore.fresh();
    const initial = store.getManifest().version;
    store.addPage();
    store.renamePage(store.getActivePageId(), "Renamed");
    expect(store.getManifest().version).toBe(initial + 2);

    const afterOps = store.getManifest().version;
    store.setActivePage(store.getPages()[0]!.id);
    store.saveCameraFor(store.getActivePageId(), { scrollX: 1, scrollY: 2, zoom: 1 });
    expect(store.getManifest().version).toBe(afterOps);
  });

  it("adopts a strictly-newer remote manifest wholesale: adds, renames, removes, repoints the active page", () => {
    const store = PageStore.fresh();
    const localId = store.getActivePageId();
    const won = store.applyRemoteManifest({
      version: store.getManifest().version + 1,
      versionNonce: 9,
      pages: [
        { id: "r1", name: "Remote 1" },
        { id: "r2", name: "Remote 2" },
      ],
    });
    expect(won).toBe(true);
    expect(store.getPages().map((page) => page.id)).toEqual(["r1", "r2"]);
    expect(store.getActivePageId()).toBe("r1"); // the local page vanished, so the first survivor takes over
    expect(store.ensureRemotePage(localId)).toBeNull(); // removed by the manifest → tombstoned
  });

  it("unions an equal-version remote manifest — two fresh peers converge to both boards side by side", () => {
    const store = PageStore.fresh();
    const localId = store.getActivePageId();
    const changed = store.applyRemoteManifest({ version: store.getManifest().version, versionNonce: 999, pages: [{ id: "peer-page", name: "Theirs" }] });
    expect(changed).toBe(true);
    expect(store.getPages().map((page) => page.id)).toEqual([localId, "peer-page"]);
    expect(store.getActivePageId()).toBe(localId); // nothing was removed, nothing repointed
  });

  it("refuses a stale or empty remote manifest", () => {
    const store = PageStore.fresh();
    const before = store.getPages();
    expect(store.applyRemoteManifest({ version: 0, versionNonce: 0, pages: [{ id: "x", name: "X" }] })).toBe(false);
    expect(store.applyRemoteManifest({ version: 99, versionNonce: 0, pages: [] })).toBe(false);
    expect(store.getPages()).toEqual(before);
  });

  it("ensureRemotePage materializes an unknown page without bumping the manifest, and refuses tombstoned ids", () => {
    const store = PageStore.fresh();
    const version = store.getManifest().version;
    const scene = store.ensureRemotePage("from-peer");
    expect(scene).not.toBeNull();
    expect(store.getPages()).toHaveLength(2);
    expect(store.getManifest().version).toBe(version);

    const second = store.addPage();
    store.removePage(second);
    expect(store.ensureRemotePage(second)).toBeNull();
  });
});

// Content revision (desktop dirty tracking): view changes must not read as edits.
describe("PageStore content revision", () => {
  it("bumps on add/rename/remove/replaceAll but NOT on setActivePage", () => {
    const store = PageStore.fresh();
    const r0 = store.getContentRevision();

    const added = store.addPage();
    expect(store.getContentRevision()).toBeGreaterThan(r0);

    const r1 = store.getContentRevision();
    store.setActivePage(added);
    store.setActivePage(store.getPages()[0]!.id);
    expect(store.getContentRevision()).toBe(r1);

    store.renamePage(added, "Renamed");
    expect(store.getContentRevision()).toBeGreaterThan(r1);

    const r2 = store.getContentRevision();
    store.removePage(added);
    expect(store.getContentRevision()).toBeGreaterThan(r2);
  });
});
