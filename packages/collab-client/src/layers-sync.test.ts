import { describe, expect, it, vi } from "vitest";
import { Scene } from "@deviva-draw/engine";
import type { LayersManifest } from "@deviva-draw/engine";
import { handleInboundMessage } from "./inbound-message-handler";
import { isPlausibleLayersManifest } from "./layers-adapter";
import { sendDocumentSnapshot } from "./outbound-sync";
import { mergeRemoteElement } from "./lww-merge";
import { generateRoomKey, importRoomKey, encryptEnvelope } from "./message-codec";
import type { CollabPagesAdapter, PagesManifest } from "./pages-adapter";
import { PresenceStore } from "./presence-state";

/**
 * Layers riding the pages snapshot: end-to-end through the real encrypt → wire → decrypt → apply
 * path, plus the hostile-peer and old-client tolerance cases the plan's red-team pinned.
 */

function makeAdapter(initial: { id: string; name: string }[]): CollabPagesAdapter & { scene(pageId: string): Scene } {
  const scenes = new Map<string, Scene>(initial.map((page) => [page.id, new Scene()]));
  const manifest: PagesManifest = { version: 1, versionNonce: 1, pages: [...initial] };
  return {
    getManifest: () => manifest,
    applyRemoteManifest: () => false,
    getScene: (pageId) => scenes.get(pageId) ?? null,
    ensureScene: (pageId) => {
      if (!scenes.has(pageId)) scenes.set(pageId, new Scene());
      return scenes.get(pageId)!;
    },
    listPageIds: () => manifest.pages.map((page) => page.id),
    getLayersManifest: (pageId) => {
      const layers = scenes.get(pageId)?.getLayersManifest() ?? null;
      return layers !== null && layers.version > 0 ? layers : null;
    },
    applyRemoteLayersManifest: (pageId, layersManifest) => void scenes.get(pageId)?.applyRemoteLayersManifest(layersManifest),
    subscribe: () => () => {},
    scene: (pageId) => scenes.get(pageId)!,
  };
}

async function makeDeps(pages: CollabPagesAdapter) {
  return {
    scene: new Scene(),
    pages,
    presence: new PresenceStore(),
    roomKey: await importRoomKey(await generateRoomKey()),
    markSynced: vi.fn(),
    onPeerLeft: vi.fn(),
    onSnapshotRequested: vi.fn(),
  };
}

describe("layers over the snapshot wire", () => {
  it("two peers converge: sender's hide/rename/add reaches the receiver through a real snapshot round-trip", async () => {
    const sender = makeAdapter([{ id: "p1", name: "Page 1" }]);
    const senderScene = sender.scene("p1");
    const annotations = senderScene.addLayer("Annotations");
    senderScene.setLayerVisible(annotations.id, false);

    const receiver = makeAdapter([{ id: "p1", name: "Page 1" }]);
    const deps = await makeDeps(receiver);
    const sent: string[] = [];
    await sendDocumentSnapshot({ roomKey: deps.roomKey, send: (data) => (sent.push(data), true) }, sender);
    expect(sent).toHaveLength(1);
    await handleInboundMessage(sent[0]!, deps);

    const receiverLayers = receiver.scene("p1").getLayers();
    expect(receiverLayers.map((layer) => ({ name: layer.name, visible: layer.visible }))).toEqual([
      { name: "Layer 1", visible: true },
      { name: "Annotations", visible: false },
    ]);
  });

  it("a never-mutated page sends NO layers manifest, so a fresh peer can't outrank real state", async () => {
    const fresh = makeAdapter([{ id: "p1", name: "Page 1" }]);
    const veteran = makeAdapter([{ id: "p1", name: "Page 1" }]);
    veteran.scene("p1").addLayer("Real");
    const veteranVersionBefore = veteran.scene("p1").getLayersManifest().version;

    const deps = await makeDeps(veteran);
    const sent: string[] = [];
    await sendDocumentSnapshot({ roomKey: deps.roomKey, send: (data) => (sent.push(data), true) }, fresh);
    await handleInboundMessage(sent[0]!, deps);

    expect(veteran.scene("p1").getLayers()).toHaveLength(2); // untouched
    expect(veteran.scene("p1").getLayersManifest().version).toBe(veteranVersionBefore);
  });

  it("a hostile empty or oversized layers manifest is rejected at the plausibility gate", () => {
    const base = { version: 99, versionNonce: 1 };
    expect(isPlausibleLayersManifest({ ...base, layers: [] })).toBe(false);
    expect(isPlausibleLayersManifest({ ...base, layers: Array.from({ length: 300 }, (_, i) => ({ id: `l${i}`, name: "x", visible: true, locked: false })) })).toBe(false);
    expect(isPlausibleLayersManifest({ ...base, layers: [{ id: "a", name: "ok", visible: "yes", locked: false }] })).toBe(false); // truthy-string flag
    expect(isPlausibleLayersManifest({ ...base, layers: [{ id: "a", name: "ok", visible: true, locked: false }] })).toBe(true);
  });

  it("the engine's adoption guard holds even if a hostile manifest slips past shape checks with an empty list", () => {
    const scene = new Scene();
    scene.addLayer("Keep");
    const hostile = { version: 999999, versionNonce: 999, layers: [] } as unknown as LayersManifest;
    expect(scene.applyRemoteLayersManifest(hostile)).toBe(false);
    expect(scene.getLayers()).toHaveLength(2);
  });

  it("remote element merges preserve layerId, reject non-string layerIds, and an old client's element without layerId simply lands unstamped", () => {
    const scene = new Scene();
    const layered = { ...new Scene().addElement({ ...basicRect(), id: "r1" }), layerId: "some-layer", version: 5, versionNonce: 1 };
    expect(mergeRemoteElement(scene, layered)).toBe(true);
    expect(scene.getElement("r1")?.layerId).toBe("some-layer"); // preserved verbatim (orphan-resolves at read time)

    const malformed = { ...layered, id: "r2", layerId: 42 };
    expect(mergeRemoteElement(scene, malformed)).toBe(false); // plausibility rejects

    const oldClient = { ...new Scene().addElement({ ...basicRect(), id: "r3" }), version: 5, versionNonce: 1 };
    expect(mergeRemoteElement(scene, oldClient)).toBe(true);
    expect(scene.getElement("r3")?.layerId).toBeUndefined();
  });

  it("a layers-free (old-client) snapshot leaves local layers untouched", async () => {
    const local = makeAdapter([{ id: "p1", name: "Page 1" }]);
    local.scene("p1").addLayer("Mine");
    const deps = await makeDeps(local);
    const envelope = await encryptEnvelope(deps.roomKey, "snapshot", {
      manifest: { version: 0, versionNonce: 0, pages: [{ id: "p1", name: "Page 1" }] },
      pages: [{ id: "p1", name: "Page 1", elements: [] }], // no layers key at all
    });
    await handleInboundMessage(JSON.stringify(envelope), deps);
    expect(local.scene("p1").getLayers()).toHaveLength(2);
  });
});

function basicRect() {
  return {
    id: "seed",
    type: "generic" as const,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0,
    strokeColor: "#000",
    backgroundColor: "transparent",
    fillStyle: "solid" as const,
    strokeWidth: 1,
    strokeStyle: "solid" as const,
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: 1,
    groupIds: [],
    frameId: null,
    boundElements: null,
    link: null,
    locked: false,
    index: "a1",
    version: 1,
    versionNonce: 1,
    updated: 1,
    isDeleted: false,
  };
}
