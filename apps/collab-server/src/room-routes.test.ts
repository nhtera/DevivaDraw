import { describe, expect, it, vi } from "vitest";
import { handleRoomUpgrade, matchRoomPath } from "./room-routes";
import type { RoomNamespace } from "./room-routes";

const VALID_ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function upgradeRequest(roomId: string, headers: Record<string, string> = { upgrade: "websocket" }): Request {
  return new Request(`https://collab.example/room/${roomId}`, { headers });
}

describe("matchRoomPath", () => {
  it("extracts the room id from a /room/{id} path", () => {
    expect(matchRoomPath(`/room/${VALID_ROOM_ID}`)).toBe(VALID_ROOM_ID);
  });

  it("returns null for a path that isn't /room/{id}", () => {
    expect(matchRoomPath("/blobs/x")).toBeNull();
    expect(matchRoomPath("/")).toBeNull();
  });

  it("decodes a percent-encoded room id", () => {
    expect(matchRoomPath("/room/a%20b")).toBe("a b");
  });
});

describe("handleRoomUpgrade", () => {
  function fakeRooms(): RoomNamespace & { fetchCalls: Request[]; idFromNameCalls: string[] } {
    const fetchCalls: Request[] = [];
    const idFromNameCalls: string[] = [];
    return {
      fetchCalls,
      idFromNameCalls,
      idFromName: (name) => {
        idFromNameCalls.push(name);
        return name;
      },
      get: () => ({
        fetch: async (request: Request) => {
          fetchCalls.push(request);
          // Real Workers can construct a `status: 101` Response paired with a `webSocket`; Node's Fetch
          // polyfill (this test's runtime) rejects that combination outside a real protocol upgrade, so
          // this fake stands in with an ordinary 2xx to prove *routing*, not the DO's actual upgrade
          // response shape (that's `room-durable-object.ts`'s job, only exercisable in a real Workers
          // runtime).
          return new Response(null, { status: 200 });
        },
      }),
    };
  }

  it("forwards a valid upgrade request to the room's DO instance", async () => {
    const rooms = fakeRooms();
    const response = await handleRoomUpgrade(upgradeRequest(VALID_ROOM_ID), VALID_ROOM_ID, rooms);
    expect(response.status).toBe(200);
    expect(rooms.idFromNameCalls).toEqual([VALID_ROOM_ID]);
    expect(rooms.fetchCalls).toHaveLength(1);
  });

  it("rejects an invalid room id with 400 without touching the DO namespace", async () => {
    const rooms = fakeRooms();
    const response = await handleRoomUpgrade(upgradeRequest("../../etc/passwd"), "../../etc/passwd", rooms);
    expect(response.status).toBe(400);
    expect(rooms.fetchCalls).toHaveLength(0);
  });

  it("rejects a non-WebSocket request with 426 without touching the DO namespace", async () => {
    const rooms = fakeRooms();
    const response = await handleRoomUpgrade(upgradeRequest(VALID_ROOM_ID, {}), VALID_ROOM_ID, rooms);
    expect(response.status).toBe(426);
    expect(rooms.fetchCalls).toHaveLength(0);
  });

  it("is case-insensitive about the Upgrade header value", async () => {
    const rooms = fakeRooms();
    const response = await handleRoomUpgrade(upgradeRequest(VALID_ROOM_ID, { upgrade: "WebSocket" }), VALID_ROOM_ID, rooms);
    expect(response.status).toBe(200);
  });

  it("never calls idFromName for a rejected room id (guards against DO namespace side effects)", async () => {
    const rooms = fakeRooms();
    const idFromName = vi.spyOn(rooms, "idFromName");
    await handleRoomUpgrade(upgradeRequest("bad id!"), "bad id!", rooms);
    expect(idFromName).not.toHaveBeenCalled();
  });
});
