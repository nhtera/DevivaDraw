import { describe, expect, it } from "vitest";
import { createRectangleElement, Scene } from "@deviva-draw/engine";
import { adoptRoomPages } from "./adopt-room-pages";
import { PageStore } from "./page-store";

/** A store as a freshly-opened client has it: one untouched starter page. */
function freshStore(): PageStore {
  return PageStore.fresh();
}

/** Simulates the room's pages arriving over the manifest union. */
function addRoomPage(store: PageStore, name: string): string {
  return store.addPage(name);
}

describe("adoptRoomPages", () => {
  it("drops the untouched starter page and lands on the room's first page", async () => {
    const store = freshStore();
    const preJoinActiveId = store.getActivePageId();
    const preJoinPageIds = new Set(store.getPages().map((page) => page.id));

    const roomPageId = addRoomPage(store, "Room page");
    await adoptRoomPages(store, { preJoinPageIds, preJoinActiveId, timeoutMs: 200 });

    expect(store.getPages().map((page) => page.id)).toEqual([roomPageId]);
    expect(store.getActivePageId()).toBe(roomPageId);
  });

  it("keeps everything when this peer drew before joining — the union is right once there is work to lose", async () => {
    const store = freshStore();
    const preJoinActiveId = store.getActivePageId();
    const preJoinPageIds = new Set(store.getPages().map((page) => page.id));
    store.getActiveScene().addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));

    const roomPageId = addRoomPage(store, "Room page");
    await adoptRoomPages(store, { preJoinPageIds, preJoinActiveId, timeoutMs: 200 });

    expect(store.getPages().map((page) => page.id).sort()).toEqual([preJoinActiveId, roomPageId].sort());
  });

  it("keeps its own page when this peer had several — more than a starter page means a real board", async () => {
    const store = freshStore();
    store.addPage("mine too");
    const preJoinActiveId = store.getActivePageId();
    const preJoinPageIds = new Set(store.getPages().map((page) => page.id));

    addRoomPage(store, "Room page");
    await adoptRoomPages(store, { preJoinPageIds, preJoinActiveId, timeoutMs: 200 });

    expect(store.getPages()).toHaveLength(3);
  });

  it("times out on an empty room and leaves this peer's page as the board", async () => {
    const store = freshStore();
    const preJoinActiveId = store.getActivePageId();
    const preJoinPageIds = new Set(store.getPages().map((page) => page.id));

    await adoptRoomPages(store, { preJoinPageIds, preJoinActiveId, timeoutMs: 60 });

    expect(store.getPages().map((page) => page.id)).toEqual([preJoinActiveId]);
    expect(store.getActivePageId()).toBe(preJoinActiveId);
  });

  it("returns immediately when a wholesale manifest adoption already replaced this peer's page", async () => {
    const store = freshStore();
    const preJoinActiveId = store.getActivePageId();
    const preJoinPageIds = new Set(store.getPages().map((page) => page.id));

    const scene = new Scene();
    store.replaceAll([{ id: "room-1", name: "Room", scene, camera: null }], "room-1");
    await adoptRoomPages(store, { preJoinPageIds, preJoinActiveId, timeoutMs: 5_000 });

    expect(store.getPages().map((page) => page.id)).toEqual(["room-1"]);
  });
});
