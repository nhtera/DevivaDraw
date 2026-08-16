import { describe, expect, it } from "vitest";
import { createRectangleElement, Scene } from "@deviva-draw/engine";
import type { AnyElement } from "@deviva-draw/engine";
import { isPlausibleRemoteElement, mergeRemoteElement, remoteElementWins } from "./lww-merge";

function rect(overrides: Partial<AnyElement> = {}): AnyElement {
  const scene = new Scene();
  const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
  return { ...el, ...overrides } as AnyElement;
}

describe("remoteElementWins", () => {
  it("always wins against an absent local element", () => {
    expect(remoteElementWins(undefined, rect({ version: 1 }))).toBe(true);
  });

  it("a strictly higher version wins outright", () => {
    const local = rect({ version: 3, versionNonce: 999 });
    const remote = rect({ version: 4, versionNonce: 1 });
    expect(remoteElementWins(local, remote)).toBe(true);
  });

  it("a strictly lower version loses outright", () => {
    const local = rect({ version: 4, versionNonce: 1 });
    const remote = rect({ version: 3, versionNonce: 999 });
    expect(remoteElementWins(local, remote)).toBe(false);
  });

  it("equal version, equal versionNonce is a no-op (already applied)", () => {
    const local = rect({ version: 2, versionNonce: 500 });
    const remote = rect({ version: 2, versionNonce: 500 });
    expect(remoteElementWins(local, remote)).toBe(false);
  });

  it("equal version breaks the tie by lexicographic versionNonce comparison, deterministically both ways", () => {
    const low = rect({ version: 5, versionNonce: 100 });
    const high = rect({ version: 5, versionNonce: 999 });
    // String("999") > String("100") lexicographically.
    expect(remoteElementWins(low, high)).toBe(true);
    expect(remoteElementWins(high, low)).toBe(false);
  });
});

describe("isPlausibleRemoteElement", () => {
  it("accepts a real element", () => {
    expect(isPlausibleRemoteElement(rect())).toBe(true);
  });

  it.each([null, undefined, "a string", 42, [], {}, { id: "x" }, { ...rect(), version: "not-a-number" }, { ...rect(), id: "" }])(
    "rejects malformed/hostile input: %j",
    (value) => {
      expect(isPlausibleRemoteElement(value)).toBe(false);
    },
  );
});

describe("mergeRemoteElement", () => {
  it("applies a winning remote element and preserves its exact version/versionNonce (no re-touch)", () => {
    const scene = new Scene();
    const remote = rect({ version: 7, versionNonce: 123 });
    const applied = mergeRemoteElement(scene, remote);
    expect(applied).toBe(true);
    expect(scene.getElement(remote.id)).toEqual(remote);
  });

  it("rejects a losing remote element without mutating the scene", () => {
    const scene = new Scene();
    const local = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const remote = { ...local, version: local.version - 1 || 0, x: 999 };
    const applied = mergeRemoteElement(scene, remote);
    expect(applied).toBe(false);
    expect(scene.getElement(local.id)).toEqual(local);
  });

  it("rejects a malformed/hostile payload without throwing", () => {
    const scene = new Scene();
    expect(mergeRemoteElement(scene, { evil: true })).toBe(false);
    expect(mergeRemoteElement(scene, null)).toBe(false);
    expect(mergeRemoteElement(scene, "drop table")).toBe(false);
  });

  it("two independent scenes converge to an identical final element after exchanging the same delta", () => {
    const alice = new Scene();
    const bob = new Scene();
    const base = alice.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    mergeRemoteElement(bob, base);

    const aliceEdit = alice.updateElement(base.id, { x: 50 })!;
    mergeRemoteElement(bob, aliceEdit);

    expect(bob.getElement(base.id)).toEqual(alice.getElement(base.id));
  });

  it("converges under a concurrent edit to the same element from two peers (same-element conflict)", () => {
    const alice = new Scene();
    const bob = new Scene();
    const base = alice.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    mergeRemoteElement(bob, base);

    // Both peers edit the same element concurrently, from the same base version.
    const aliceEdit = alice.updateElement(base.id, { x: 10 })!;
    const bobEdit = bob.updateElement(base.id, { x: 20 })!;

    // Exchange: each applies the other's delta through the same LWW rule.
    mergeRemoteElement(alice, bobEdit);
    mergeRemoteElement(bob, aliceEdit);

    expect(alice.getElement(base.id)).toEqual(bob.getElement(base.id));
  });

  it("converges under a delete-vs-edit conflict on the same element", () => {
    const alice = new Scene();
    const bob = new Scene();
    const base = alice.addElement(createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }));
    mergeRemoteElement(bob, base);

    const aliceDelete = alice.deleteElement(base.id)!;
    const bobEdit = bob.updateElement(base.id, { x: 99 })!;

    mergeRemoteElement(alice, bobEdit);
    mergeRemoteElement(bob, aliceDelete);

    expect(alice.getElement(base.id)).toEqual(bob.getElement(base.id));
  });

  it("converges under a concurrent z-order (fractional index) race across three peers", () => {
    const scenes = [new Scene(), new Scene(), new Scene()];
    const base = scenes[0]!.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    for (const scene of scenes.slice(1)) mergeRemoteElement(scene, base);

    // Every peer concurrently reorders the same element to a different index string.
    const edits = scenes.map((scene, i) => scene.updateElement(base.id, { index: `a${i}` })!);

    // Full gossip: every peer applies every other peer's edit (including their own, a harmless no-op).
    for (const scene of scenes) {
      for (const edit of edits) mergeRemoteElement(scene, edit);
    }

    const finalStates = scenes.map((scene) => scene.getElement(base.id));
    expect(finalStates[1]).toEqual(finalStates[0]);
    expect(finalStates[2]).toEqual(finalStates[0]);
  });

  it("converges under 3-way concurrent edits to the same element (not just 2-way)", () => {
    const scenes = [new Scene(), new Scene(), new Scene()];
    const base = scenes[0]!.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    for (const scene of scenes.slice(1)) mergeRemoteElement(scene, base);

    const edits = scenes.map((scene, i) => scene.updateElement(base.id, { x: i * 100 })!);

    for (const scene of scenes) {
      for (const edit of edits) mergeRemoteElement(scene, edit);
    }

    const finalStates = scenes.map((scene) => scene.getElement(base.id));
    expect(finalStates[1]).toEqual(finalStates[0]);
    expect(finalStates[2]).toEqual(finalStates[0]);
  });
});

describe("mergeRemoteElement — table elements", () => {
  it("a remote table passes LWW merge verbatim, grid arrays intact", async () => {
    const { createTableElement, Scene: EngineScene } = await import("@deviva-draw/engine");
    const source = new EngineScene();
    const table = source.addElement(
      createTableElement({ x: 0, y: 0, columnWidths: [100, 60], rowHeights: [40, 30], cells: [["a", "b"], ["c", "d"]] }),
    );
    const receiver = new EngineScene();
    expect(mergeRemoteElement(receiver, table)).toBe(true);
    const stored = receiver.getElement(table.id);
    expect(stored).toMatchObject({ type: "table", columnWidths: [100, 60], rowHeights: [40, 30] });
    expect((stored as { cells: string[][] }).cells).toEqual([["a", "b"], ["c", "d"]]);
  });
});
