import { describe, expect, it } from "vitest";
import { readAttachment } from "./room-durable-object";

/**
 * Only the hibernation attachment is covered here, and deliberately so: the rest of `RoomDO` is
 * Workers-runtime glue (`WebSocketPair`, `acceptWebSocket`, `DurableObjectState`) that no hermetic
 * test can construct, and whose decisions all live in `room-connection-registry.ts` anyway.
 *
 * This one function is the exception because it is the phase's sharpest regression risk. Sockets that
 * were accepted before roles existed carry a bare `peerId` string; the moment a long-running room
 * wakes from hibernation on the new code, every one of those has to rehydrate — reading them as
 * `{peerId: undefined}` would deregister live peers from a room that is still perfectly healthy, and
 * nothing else in the system would report an error.
 */
describe("readAttachment", () => {
  it("reads the current shape", () => {
    expect(readAttachment({ peerId: "p1", role: "viewer" })).toEqual({ peerId: "p1", role: "viewer" });
    expect(readAttachment({ peerId: "p1", role: "editor" })).toEqual({ peerId: "p1", role: "editor" });
  });

  it("reads a pre-roles bare string as an editor, so a hibernating room survives this deploy", () => {
    expect(readAttachment("legacy-peer-id")).toEqual({ peerId: "legacy-peer-id", role: "editor" });
  });

  it("treats an unrecognised role as editor rather than dropping the peer", () => {
    // The role was verified at upgrade time; a value that is neither string is a corrupted attachment,
    // and losing a live connection over it is worse than the connection keeping the default it had.
    expect(readAttachment({ peerId: "p1" })).toEqual({ peerId: "p1", role: "editor" });
    expect(readAttachment({ peerId: "p1", role: 7 })).toEqual({ peerId: "p1", role: "editor" });
  });

  it("returns null for anything that is not an attachment this DO wrote", () => {
    expect(readAttachment(null)).toBeNull();
    expect(readAttachment(undefined)).toBeNull();
    expect(readAttachment("")).toBeNull();
    expect(readAttachment(42)).toBeNull();
    expect(readAttachment({ role: "editor" })).toBeNull();
    expect(readAttachment({ peerId: "", role: "editor" })).toBeNull();
  });
});
