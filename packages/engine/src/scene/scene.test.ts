import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGenericElement } from "../elements/element-types";
import { Scene } from "./scene";

describe("Scene CRUD", () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene();
  });

  it("starts empty", () => {
    expect(scene.getElements()).toEqual([]);
  });

  it("addElement stores the element and getElement/getElements can find it", () => {
    const input = createGenericElement({ x: 1, y: 2 });
    const stored = scene.addElement(input);

    expect(scene.getElement(stored.id)).toEqual(stored);
    expect(scene.getElements()).toEqual([stored]);
  });

  it("getElement returns undefined for an unknown id", () => {
    expect(scene.getElement("nope")).toBeUndefined();
  });

  it("getElements sorts by fractional index (z-order)", () => {
    const a = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const b = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const c = scene.addElement(createGenericElement({ x: 0, y: 0 }));

    // Each add appends after the current last element, so insertion order == z-order here.
    expect(scene.getElements().map((el) => el.id)).toEqual([a.id, b.id, c.id]);
    expect(a.index < b.index).toBe(true);
    expect(b.index < c.index).toBe(true);
  });

  it("getElements breaks a tie between equal index strings deterministically by id — order is identical regardless of insertion order (regression: cross-peer z-order divergence)", () => {
    // Two distinct elements sharing the exact same index string — the scenario a remote-merge LWW
    // resolver can legitimately produce: `generateKeyBetween` is a pure function of its bounds, so two
    // peers concurrently creating different elements at the same insertion point compute an identical
    // index. Without a secondary tiebreak, two scenes that received the same two elements in opposite
    // insertion orders would disagree on z-order.
    const sceneA = new Scene();
    const sceneB = new Scene();
    const SHARED_INDEX = "a1";
    const elementX = { ...createGenericElement({ x: 0, y: 0 }), index: SHARED_INDEX };
    const elementY = { ...createGenericElement({ x: 0, y: 0 }), index: SHARED_INDEX };
    expect(elementX.id).not.toBe(elementY.id);

    sceneA.addElement(elementX);
    sceneA.addElement(elementY);
    sceneB.addElement(elementY);
    sceneB.addElement(elementX);

    const orderA = sceneA.getElements().map((el) => el.id);
    const orderB = sceneB.getElements().map((el) => el.id);
    expect(orderA).toEqual(orderB);
    // Confirms the tiebreak is actually exercised (lexicographic by id), not just incidentally stable.
    expect(orderA).toEqual([elementX.id, elementY.id].sort());
  });

  it("addElement respects an explicit index instead of always appending to the back", () => {
    const a = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const c = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const between = createGenericElement({ x: 0, y: 0 });
    const middleIndex = (() => {
      // Insert strictly between a and c using the same helper the store uses internally.
      const [lo, hi] = [a.index, c.index];
      return lo < hi ? `${lo}m` : `${hi}m`;
    })();
    const b = scene.addElement({ ...between, index: middleIndex });

    const ids = scene.getElements().map((el) => el.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(c.id));
  });

  it("updateElement applies a partial change and returns the updated element", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const updated = scene.updateElement(created.id, { x: 50, y: 60 });

    expect(updated?.x).toBe(50);
    expect(updated?.y).toBe(60);
    expect(scene.getElement(created.id)?.x).toBe(50);
  });

  it("updateElement returns undefined for an unknown id", () => {
    expect(scene.updateElement("nope", { x: 1 })).toBeUndefined();
  });

  it("deleteElement soft-deletes: element stays retrievable with isDeleted true", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const deleted = scene.deleteElement(created.id);

    expect(deleted?.isDeleted).toBe(true);
    expect(scene.getElement(created.id)?.isDeleted).toBe(true);
    // Soft delete: still present in the full element list, not purged.
    expect(scene.getElements().map((el) => el.id)).toContain(created.id);
  });

  it("deleteElement returns undefined for an unknown id", () => {
    expect(scene.deleteElement("nope")).toBeUndefined();
  });

  it("addElement throws when the id already exists in the scene", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const duplicate = { ...createGenericElement({ x: 1, y: 1 }), id: created.id };

    expect(() => scene.addElement(duplicate)).toThrow(/already exists/);
    // The original element must survive the rejected duplicate insert untouched.
    expect(scene.getElement(created.id)?.x).toBe(0);
    expect(scene.getElements()).toHaveLength(1);
  });
});

describe("Scene mutation invariants (version/versionNonce)", () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene();
  });

  it("addElement bumps a freshly-created element from the version=0 sentinel to version=1", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    expect(created.version).toBe(1);
    expect(created.versionNonce).not.toBe(0);
  });

  it("every updateElement call bumps version by exactly one and reassigns versionNonce", () => {
    let element = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const seenNonces = new Set([element.versionNonce]);
    const seenVersions = [element.version];

    for (let i = 0; i < 5; i += 1) {
      const previousVersion = element.version;
      const previousNonce = element.versionNonce;
      const next = scene.updateElement(element.id, { x: i });
      expect(next).toBeDefined();
      element = next!;
      expect(element.version).toBe(previousVersion + 1);
      expect(element.versionNonce).not.toBe(previousNonce);
      seenNonces.add(element.versionNonce);
      seenVersions.push(element.version);
    }

    expect(seenVersions).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seenNonces.size).toBe(6); // all distinct across the whole sequence
  });

  it("deleteElement (soft-delete) also bumps version/versionNonce like any other mutation", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const deleted = scene.deleteElement(created.id);
    expect(deleted?.version).toBe(created.version + 1);
    expect(deleted?.versionNonce).not.toBe(created.versionNonce);
  });

  it("updates set the `updated` timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    vi.setSystemTime(9000);
    const updated = scene.updateElement(created.id, { x: 1 });
    expect(updated?.updated).toBe(9000);
    vi.useRealTimers();
  });

  it("stored elements are frozen: a direct field write throws and the version is unchanged", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const retrieved = scene.getElement(created.id);
    expect(retrieved).toBeDefined();

    // A caller reaching past the CRUD API to mutate the live object directly must fail loudly
    // (strict-mode write to a frozen object throws) rather than silently skip the version bump.
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately bypassing the type system to prove the runtime guard, not testing types
      (retrieved as any).x = 999;
    }).toThrow(TypeError);

    expect(scene.getElement(created.id)?.x).toBe(0);
    expect(scene.getElement(created.id)?.version).toBe(created.version);
  });

  it("frozen elements also reject mutation of their nested groupIds array", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0, groupIds: ["g1"] }));
    expect(() => created.groupIds.push("g2")).toThrow(TypeError);
    expect(scene.getElement(created.id)?.groupIds).toEqual(["g1"]);
  });
});

describe("Scene subscriptions", () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene();
  });

  it("notifies subscribers on addElement, updateElement, and deleteElement", () => {
    const listener = vi.fn();
    scene.subscribe(listener);

    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    scene.updateElement(created.id, { x: 1 });
    scene.deleteElement(created.id);

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does not notify a listener after it unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = scene.subscribe(listener);
    unsubscribe();

    scene.addElement(createGenericElement({ x: 0, y: 0 }));

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify on a no-op mutation of an unknown id", () => {
    const listener = vi.fn();
    scene.subscribe(listener);

    scene.updateElement("nope", { x: 1 });
    scene.deleteElement("nope");

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple independent subscribers", () => {
    const first = vi.fn();
    const second = vi.fn();
    scene.subscribe(first);
    scene.subscribe(second);

    scene.addElement(createGenericElement({ x: 0, y: 0 }));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not stack-overflow when a listener mutates the scene (re-entrant notify)", () => {
    let notifyCount = 0;
    let hasTriggeredNestedMutation = false;

    scene.subscribe(() => {
      notifyCount += 1;
      // Simulate an autosave/collab-echo listener that reacts to a change by writing back into
      // the scene — this used to recurse straight back into notify() and blow the call stack.
      if (!hasTriggeredNestedMutation) {
        hasTriggeredNestedMutation = true;
        scene.addElement(createGenericElement({ x: 0, y: 0 }));
      }
    });

    expect(() => scene.addElement(createGenericElement({ x: 0, y: 0 }))).not.toThrow();
    // One dispatch for the original add, plus one more (queued, not nested) for the mutation the
    // listener itself triggered.
    expect(notifyCount).toBe(2);
    expect(scene.getElements()).toHaveLength(2);
  });

  it("restoreElement inserts without bumping version/versionNonce (unlike addElement)", () => {
    const element = { ...createGenericElement({ x: 0, y: 0 }), id: "restored-1", version: 5, versionNonce: 42, updated: 999, index: "a0" };
    scene.restoreElement(element);
    expect(scene.getElement("restored-1")).toEqual(element);
  });

  it("restoreElement throws on a duplicate id, same as addElement", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    expect(() => scene.restoreElement({ ...created, id: created.id })).toThrow(/already exists/);
  });

  it("applyRemoteElement inserts a brand-new element without bumping version/versionNonce, unlike addElement", () => {
    const remote = { ...createGenericElement({ x: 0, y: 0 }), id: "remote-1", version: 7, versionNonce: 123, updated: 555, index: "a0" };
    const result = scene.applyRemoteElement(remote);
    expect(result).toEqual(remote);
    expect(scene.getElement("remote-1")).toEqual(remote);
  });

  it("applyRemoteElement overwrites an existing element with the exact given fields (no re-touch)", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const remoteWinner = { ...created, x: 999, version: created.version + 5, versionNonce: 4242 };
    scene.applyRemoteElement(remoteWinner);
    expect(scene.getElement(created.id)).toEqual(remoteWinner);
  });

  it("applyRemoteElement never throws on an id that already exists, unlike restoreElement", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    expect(() => scene.applyRemoteElement({ ...created, x: 5 })).not.toThrow();
  });

  it("applyRemoteElement freezes the stored element (and its nested groupIds/boundElements/roundness), same as touch() — a direct write must throw, not silently corrupt the store", () => {
    const remote = {
      ...createGenericElement({ x: 0, y: 0 }),
      id: "remote-frozen-1",
      version: 1,
      versionNonce: 1,
      index: "a0",
      groupIds: ["group-1"],
      boundElements: [{ id: "bound-1", type: "text" }],
      roundness: { type: 1 },
    };
    scene.applyRemoteElement(remote);
    const stored = scene.getElement("remote-frozen-1")!;

    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.groupIds)).toBe(true);
    expect(Object.isFrozen(stored.boundElements)).toBe(true);
    expect(Object.isFrozen(stored.boundElements![0])).toBe(true);
    expect(Object.isFrozen(stored.roundness)).toBe(true);
    // This test file is an ES module, which is always strict mode — writing to a frozen object throws
    // a TypeError rather than silently no-oping.
    expect(() => {
      (stored as { x: number }).x = 12345;
    }).toThrow();
    expect(scene.getElement("remote-frozen-1")!.x).toBe(remote.x);
  });

  it("applyRemoteElement runs registered update hooks against the applied element", () => {
    const seen: string[] = [];
    scene.registerUpdateHook((updated) => seen.push(updated.id));
    const remote = { ...createGenericElement({ x: 0, y: 0 }), id: "remote-2", version: 1, versionNonce: 1, index: "a0" };

    scene.applyRemoteElement(remote);

    expect(seen).toEqual(["remote-2"]);
  });

  it("applyRemoteElement notifies subscribers, same as any other mutation", () => {
    const listener = vi.fn();
    scene.subscribe(listener);
    scene.applyRemoteElement({ ...createGenericElement({ x: 0, y: 0 }), id: "remote-3", version: 1, versionNonce: 1, index: "a0" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple mutations queued from within a single listener dispatch into one extra pass", () => {
    let notifyCount = 0;
    let hasTriggeredNestedMutations = false;

    scene.subscribe(() => {
      notifyCount += 1;
      if (!hasTriggeredNestedMutations) {
        hasTriggeredNestedMutations = true;
        scene.addElement(createGenericElement({ x: 0, y: 0 }));
        scene.addElement(createGenericElement({ x: 0, y: 0 }));
        scene.addElement(createGenericElement({ x: 0, y: 0 }));
      }
    });

    scene.addElement(createGenericElement({ x: 0, y: 0 }));

    // 3 nested mutations queued during one dispatch collapse into a single redelivered pass.
    expect(notifyCount).toBe(2);
    expect(scene.getElements()).toHaveLength(4);
  });
});

describe("Scene.toJSON / Scene.fromJSON", () => {
  it("toJSON delegates to serializeScene — round trips through Scene.fromJSON", () => {
    const scene = new Scene();
    scene.addElement(createGenericElement({ x: 1, y: 2, width: 10, height: 10 }));

    const document = scene.toJSON();
    const parsed = JSON.parse(JSON.stringify(document));
    const result = Scene.fromJSON(parsed);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scene.getElements()).toEqual(scene.getElements());
  });

  it("Scene.fromJSON never throws for malformed input — returns an ok:false result", () => {
    expect(() => Scene.fromJSON({ garbage: true })).not.toThrow();
    expect(Scene.fromJSON({ garbage: true }).ok).toBe(false);
  });

  it("Scene.fromJSON is a static factory: a rejected load never touches any existing live Scene", () => {
    const live = new Scene();
    live.addElement(createGenericElement({ x: 0, y: 0 }));
    const before = live.getElements();

    Scene.fromJSON({ garbage: true });

    expect(live.getElements()).toEqual(before);
  });
});
