/**
 * Contract tests for the canonical PageStore-backed `CollabPagesAdapter`: the subscribe filter
 * (only snapshot-worthy page-list/layers changes notify), the version-0 layers withhold, and the
 * tombstone-aware scene accessors. Full wire behavior over `CollabSession` is covered by
 * `pages-sync.test.ts`; this file pins the adapter glue itself.
 */
import { describe, expect, it, vi } from "vitest";
import { PageStore } from "./page-store";
import { createPageStoreCollabAdapter } from "./page-store-adapter";

describe("createPageStoreCollabAdapter", () => {
  it("exposes the store's manifest, page ids, and scenes (tombstones respected)", () => {
    const store = PageStore.fresh();
    const adapter = createPageStoreCollabAdapter(store);
    const secondId = store.addPage("Design");

    expect(adapter.listPageIds()).toEqual(store.getPages().map((page) => page.id));
    expect(adapter.getManifest()).toEqual(store.getManifest());
    expect(adapter.getScene(secondId)).toBe(store.getSceneById(secondId));

    store.removePage(secondId);
    // A tombstoned page must not be resurrectable through the adapter.
    expect(adapter.ensureScene(secondId)).toBeNull();
    expect(adapter.ensureScene("fresh-remote-page")).not.toBeNull();
  });

  it("notifies on page-list and layers changes, but not on active-page switches", () => {
    const store = PageStore.fresh();
    const adapter = createPageStoreCollabAdapter(store);
    const firstId = store.getActivePageId();
    const secondId = store.addPage();

    const listener = vi.fn();
    adapter.subscribe(listener);

    store.setActivePage(firstId);
    expect(listener).not.toHaveBeenCalled(); // switching pages is not a document change

    store.renamePage(secondId, "Renamed");
    expect(listener).toHaveBeenCalledTimes(1);

    store.addPage("Third");
    expect(listener).toHaveBeenCalledTimes(2);

    // A layer op notifies the Scene (whose CollabSession subscription handles sync), not the
    // store — but its version bump must dirty the manifest key so the NEXT page-list change
    // publishes a snapshot carrying the new layers state.
    store.getSceneById(firstId)!.addLayer();
    expect(listener).toHaveBeenCalledTimes(2);
    store.setActivePage(secondId);
    expect(listener).toHaveBeenCalledTimes(3); // key changed by the layers bump, surfaced by the store notify
  });

  it("withholds a never-mutated (version 0) layers manifest so fresh peers can't outrank real state", () => {
    const store = PageStore.fresh();
    const adapter = createPageStoreCollabAdapter(store);
    const pageId = store.getActivePageId();

    expect(adapter.getLayersManifest?.(pageId)).toBeNull();
    store.getSceneById(pageId)!.addLayer();
    expect(adapter.getLayersManifest?.(pageId)).not.toBeNull();
  });
});
