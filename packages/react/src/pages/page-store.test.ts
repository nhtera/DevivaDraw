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
});
