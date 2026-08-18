import { describe, expect, it, vi } from "vitest";
import { createRectangleElement, Scene } from "@deviva-draw/engine";
import { encryptEnvelope, decryptEnvelope, generateRoomKey, importRoomKey } from "./message-codec";
import { handleInboundMessage } from "./inbound-message-handler";
import { flushElementDeltas, sendDocumentSnapshot } from "./outbound-sync";
import { isPlausibleManifest, remoteManifestWins } from "./pages-adapter";
import type { CollabPagesAdapter, PagesManifest } from "./pages-adapter";
import { PresenceStore } from "./presence-state";

/** In-memory adapter mirroring the react PageStore's contract, small enough to assert against directly. */
function makePagesAdapter(initial: Array<{ id: string; name: string }>) {
  const scenes = new Map<string, Scene>(initial.map((page) => [page.id, new Scene()]));
  const tombstoned = new Set<string>();
  let manifest: PagesManifest = { version: 1, versionNonce: 1, pages: [...initial] };
  const adapter: CollabPagesAdapter & { tombstone(id: string): void; manifest(): PagesManifest } = {
    getManifest: () => manifest,
    applyRemoteManifest: (remote) => {
      if (!remoteManifestWins(manifest, remote)) return false;
      manifest = remote;
      for (const entry of remote.pages) if (!scenes.has(entry.id)) scenes.set(entry.id, new Scene());
      return true;
    },
    getScene: (pageId) => scenes.get(pageId) ?? null,
    ensureScene: (pageId) => {
      if (tombstoned.has(pageId)) return null;
      if (!scenes.has(pageId)) scenes.set(pageId, new Scene());
      return scenes.get(pageId)!;
    },
    listPageIds: () => manifest.pages.map((page) => page.id),
    // Delegates straight to the engine scene — the react adapter does the same.
    getLayersManifest: (pageId) => {
      const layers = scenes.get(pageId)?.getLayersManifest() ?? null;
      return layers !== null && layers.version > 0 ? layers : null;
    },
    applyRemoteLayersManifest: (pageId, layersManifest) => void scenes.get(pageId)?.applyRemoteLayersManifest(layersManifest),
    subscribe: () => () => {},
    tombstone: (id) => void tombstoned.add(id),
    manifest: () => manifest,
  };
  return adapter;
}

async function makeDeps(pages?: CollabPagesAdapter) {
  const scene = new Scene();
  const presence = new PresenceStore();
  const roomKey = await importRoomKey(await generateRoomKey());
  const markSynced = vi.fn();
  const onPeerLeft = vi.fn();
  const onPeerJoined = vi.fn();
  const onSnapshotRequested = vi.fn();
  return { scene, pages, presence, roomKey, markSynced, onPeerLeft, onPeerJoined, onSnapshotRequested };
}

describe("pageId-tagged element deltas", () => {
  it("routes a tagged delta to that page's scene — creating the page — and namespaces markSynced", async () => {
    const adapter = makePagesAdapter([{ id: "p1", name: "Page 1" }]);
    const deps = await makeDeps(adapter);
    const element = new Scene().addElement(createRectangleElement({ x: 5, y: 5, width: 1, height: 1 }));
    const envelope = await encryptEnvelope(deps.roomKey, "element-delta", { element, pageId: "p-new" });

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(adapter.getScene("p-new")!.getElement(element.id)).toEqual(element);
    expect(deps.scene.getElement(element.id)).toBeFalsy(); // never lands on the default scene
    expect(deps.markSynced).toHaveBeenCalledWith(element.id, element.version, "p-new");
  });

  it("drops a delta for a deleted (tombstoned) page instead of resurrecting it", async () => {
    const adapter = makePagesAdapter([{ id: "p1", name: "Page 1" }]);
    adapter.tombstone("p-gone");
    const deps = await makeDeps(adapter);
    const element = new Scene().addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const envelope = await encryptEnvelope(deps.roomKey, "element-delta", { element, pageId: "p-gone" });

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(adapter.getScene("p-gone")).toBeNull();
    expect(deps.markSynced).not.toHaveBeenCalled();
  });

  it("an un-tagged delta from a pre-pages peer still lands on the default scene", async () => {
    const adapter = makePagesAdapter([{ id: "p1", name: "Page 1" }]);
    const deps = await makeDeps(adapter);
    const element = new Scene().addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const envelope = await encryptEnvelope(deps.roomKey, "element-delta", { element });

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(deps.scene.getElement(element.id)).toEqual(element);
  });
});

describe("document snapshots", () => {
  it("applies a winning manifest and merges each page's elements into its page", async () => {
    const adapter = makePagesAdapter([{ id: "p1", name: "Page 1" }]);
    const deps = await makeDeps(adapter);
    const remoteScene = new Scene();
    const element = remoteScene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const payload = {
      manifest: { version: 2, versionNonce: 7, pages: [{ id: "p1", name: "Renamed" }, { id: "p2", name: "Second" }] },
      pages: [
        { id: "p1", name: "Renamed", elements: [] },
        { id: "p2", name: "Second", elements: [element] },
      ],
    };
    const envelope = await encryptEnvelope(deps.roomKey, "snapshot", payload);

    await handleInboundMessage(JSON.stringify(envelope), deps);

    expect(adapter.manifest().pages.map((page) => page.name)).toEqual(["Renamed", "Second"]);
    expect(adapter.getScene("p2")!.getElement(element.id)).toEqual(element);
    expect(deps.markSynced).toHaveBeenCalledWith(element.id, element.version, "p2");
  });

  it("a losing manifest is refused but its elements still merge (elements are their own LWW)", async () => {
    const adapter = makePagesAdapter([{ id: "p1", name: "Local name" }]);
    const deps = await makeDeps(adapter);
    const element = new Scene().addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const payload = {
      manifest: { version: 0, versionNonce: 0, pages: [{ id: "p1", name: "Stale name" }] },
      pages: [{ id: "p1", name: "Stale name", elements: [element] }],
    };
    await handleInboundMessage(JSON.stringify(await encryptEnvelope(deps.roomKey, "snapshot", payload)), deps);

    expect(adapter.manifest().pages[0]!.name).toBe("Local name");
    expect(adapter.getScene("p1")!.getElement(element.id)).toEqual(element);
  });

  it("a legacy single-scene snapshot lands on the default scene", async () => {
    const adapter = makePagesAdapter([{ id: "p1", name: "Page 1" }]);
    const deps = await makeDeps(adapter);
    const element = new Scene().addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    await handleInboundMessage(JSON.stringify(await encryptEnvelope(deps.roomKey, "snapshot", { elements: [element] })), deps);
    expect(deps.scene.getElement(element.id)).toEqual(element);
  });
});

describe("outbound multi-page sync", () => {
  it("tags deltas with their pageId and namespaces syncedVersions per page", async () => {
    const roomKey = await importRoomKey(await generateRoomKey());
    const scene = new Scene();
    const element = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const sent: string[] = [];
    const syncedVersions = new Map<string, number>();

    await flushElementDeltas({ scene, pageId: "p9", roomKey, send: (data) => (sent.push(data), true) }, syncedVersions);

    expect(sent).toHaveLength(1);
    const decrypted = await decryptEnvelope(roomKey, JSON.parse(sent[0]!));
    if (!decrypted.ok) throw new Error("decrypt failed");
    expect((decrypted.payload as { pageId: string }).pageId).toBe("p9");
    expect(syncedVersions.get(`p9/${element.id}`)).toBe(element.version);
    expect(syncedVersions.has(element.id)).toBe(false);
  });

  it("sendDocumentSnapshot carries the manifest and every page's elements", async () => {
    const adapter = makePagesAdapter([
      { id: "p1", name: "One" },
      { id: "p2", name: "Two" },
    ]);
    const element = adapter.getScene("p2")!.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const roomKey = await importRoomKey(await generateRoomKey());
    const sent: string[] = [];

    await sendDocumentSnapshot({ roomKey, send: (data) => (sent.push(data), true) }, adapter);

    const decrypted = await decryptEnvelope(roomKey, JSON.parse(sent[0]!));
    if (!decrypted.ok) throw new Error("decrypt failed");
    const payload = decrypted.payload as { manifest: PagesManifest; pages: Array<{ id: string; elements: unknown[] }> };
    expect(payload.manifest.pages.map((page) => page.id)).toEqual(["p1", "p2"]);
    expect(payload.pages[1]!.elements).toEqual([element]);
  });
});

describe("manifest primitives", () => {
  it("remoteManifestWins follows the element LWW shape (version, then lexicographic nonce)", () => {
    expect(remoteManifestWins({ version: 1, versionNonce: 5 }, { version: 2, versionNonce: 1 })).toBe(true);
    expect(remoteManifestWins({ version: 2, versionNonce: 1 }, { version: 1, versionNonce: 9 })).toBe(false);
    expect(remoteManifestWins({ version: 3, versionNonce: 100 }, { version: 3, versionNonce: 99 })).toBe(String("99") > String("100"));
  });

  it("isPlausibleManifest rejects an empty page list and malformed entries", () => {
    expect(isPlausibleManifest({ version: 1, versionNonce: 1, pages: [] })).toBe(false);
    expect(isPlausibleManifest({ version: 1, versionNonce: 1, pages: [{ id: "", name: "x" }] })).toBe(false);
    expect(isPlausibleManifest({ version: 1, versionNonce: 1, pages: [{ id: "a", name: "x" }] })).toBe(true);
  });
});
