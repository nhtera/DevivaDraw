/**
 * The canonical `CollabPagesAdapter` over a `PageStore` — extracted verbatim from the browser
 * shell's collab hook so the headless MCP live-session bridge runs the exact same multi-page
 * semantics (manifest LWW, tombstones, layers piggyback, snapshot-worthy-change detection) as a
 * real browser tab. Any behavior change here is a protocol-level change for every peer kind.
 */
import type { CollabPagesAdapter } from "./pages-adapter";
import type { PageStore } from "./page-store";

export function createPageStoreCollabAdapter(pageStore: PageStore): CollabPagesAdapter {
  return {
    getManifest: () => pageStore.getManifest(),
    applyRemoteManifest: (manifest) => pageStore.applyRemoteManifest(manifest),
    getScene: (pageId) => pageStore.getSceneById(pageId),
    ensureScene: (pageId) => pageStore.ensureRemotePage(pageId),
    listPageIds: () => pageStore.getPages().map((page) => page.id),
    // Version-0 (never locally mutated) lists are withheld so a fresh peer can never outrank
    // real layer state with its constructor default.
    getLayersManifest: (pageId) => {
      const layers = pageStore.getSceneById(pageId)?.getLayersManifest() ?? null;
      return layers !== null && layers.version > 0 ? layers : null;
    },
    applyRemoteLayersManifest: (pageId, manifest) => void pageStore.getSceneById(pageId)?.applyRemoteLayersManifest(manifest),
    // Filtered to *page-list* changes (the manifest key covers add/rename/remove/reorder and
    // the silent remote-page materialization): an active-page switch or camera park must not
    // read as "the document changed" and trigger a snapshot broadcast.
    subscribe: (listener) => {
      const manifestKey = () => {
        const manifest = pageStore.getManifest();
        // Per-page layers counters ride the key so a layer op (or a remote adoption) dirties
        // the manifest and reaches peers via the prompt snapshot, not the 30s timer.
        const layersKey = manifest.pages.map((page) => pageStore.getSceneById(page.id)?.getLayersVersion() ?? 0).join(".");
        return `${manifest.version}:${manifest.versionNonce}:${layersKey}:${manifest.pages.map((page) => page.id + page.name).join(",")}`;
      };
      let last = manifestKey();
      return pageStore.subscribe(() => {
        const key = manifestKey();
        if (key === last) return;
        last = key;
        listener();
      });
    },
  };
}
