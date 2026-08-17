/**
 * `Scene.batch` — collapsing many mutations into one subscriber notification.
 *
 * The invariant that matters is not just "fewer notifications": update *hooks* must still run per
 * element (a bound arrow has to reroute as part of the mutation that moved its shape), and
 * subscribers must never be left believing nothing changed — including when the batched work throws
 * partway through.
 */
import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "./scene";

function sceneWith(count: number): { scene: Scene; ids: string[] } {
  const scene = new Scene();
  const ids = Array.from({ length: count }, (_, i) => scene.addElement(createRectangleElement({ x: i * 10, y: 0, width: 10, height: 10 })).id);
  return { scene, ids };
}

describe("Scene.batch", () => {
  it("notifies once for many mutations instead of once each", () => {
    const { scene, ids } = sceneWith(50);
    const listener = vi.fn();
    scene.subscribe(listener);

    scene.batch(() => {
      for (const id of ids) scene.updateElement(id, { x: 999 });
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("without a batch, the same mutations notify once each — the cost this exists to remove", () => {
    const { scene, ids } = sceneWith(50);
    const listener = vi.fn();
    scene.subscribe(listener);

    for (const id of ids) scene.updateElement(id, { x: 999 });

    expect(listener).toHaveBeenCalledTimes(50);
  });

  it("still applies every mutation — deferring the signal never defers the data", () => {
    const { scene, ids } = sceneWith(10);
    scene.batch(() => {
      for (const id of ids) scene.updateElement(id, { x: 42 });
    });

    for (const id of ids) expect(scene.getElement(id)?.x).toBe(42);
  });

  it("runs update hooks inline per element, not deferred with the notification", () => {
    const { scene, ids } = sceneWith(5);
    const hook = vi.fn();
    scene.registerUpdateHook(hook);

    scene.batch(() => {
      for (const id of ids) scene.updateElement(id, { x: 1 });
    });

    // One hook call per mutation — a binding cascade must not wait for the batch to close.
    expect(hook).toHaveBeenCalledTimes(5);
  });

  it("notifies exactly once when a hook mutates the scene during the batch", () => {
    const { scene, ids } = sceneWith(3);
    const extra = scene.addElement(createRectangleElement({ x: 0, y: 500, width: 10, height: 10 }));
    const listener = vi.fn();
    // A hook that writes back into the scene is the binding-reroute shape: its own notify must join
    // the open batch rather than ending it early.
    scene.registerUpdateHook((updated) => {
      if (updated.id !== extra.id) scene.updateElement(extra.id, { y: updated.x });
    });
    scene.subscribe(listener);

    scene.batch(() => {
      for (const id of ids) scene.updateElement(id, { x: 7 });
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(scene.getElement(extra.id)?.y).toBe(7);
  });

  it("nested batches join the outermost one", () => {
    const { scene, ids } = sceneWith(4);
    const listener = vi.fn();
    scene.subscribe(listener);

    scene.batch(() => {
      scene.updateElement(ids[0]!, { x: 1 });
      scene.batch(() => {
        scene.updateElement(ids[1]!, { x: 2 });
      });
      expect(listener).not.toHaveBeenCalled(); // the inner batch must not flush
      scene.updateElement(ids[2]!, { x: 3 });
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("still notifies about the mutations that landed when the batch throws", () => {
    const { scene, ids } = sceneWith(3);
    const listener = vi.fn();
    scene.subscribe(listener);

    expect(() =>
      scene.batch(() => {
        scene.updateElement(ids[0]!, { x: 5 });
        throw new Error("mid-batch failure");
      }),
    ).toThrow("mid-batch failure");

    // Leaving subscribers stale about a mutation that really happened would be worse than the throw.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(scene.getElement(ids[0]!)?.x).toBe(5);
  });

  it("a listener throwing during the flush never masks the exception the batch was already throwing", () => {
    // The flush runs in a `finally`, so an exception escaping it would REPLACE `mutate`'s — the real
    // bug would vanish and only the listener's error would surface.
    const { scene, ids } = sceneWith(2);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    scene.subscribe(() => {
      throw new Error("listener exploded");
    });

    expect(() =>
      scene.batch(() => {
        scene.updateElement(ids[0]!, { x: 1 });
        throw new Error("the real bug");
      }),
    ).toThrow("the real bug");

    expect(consoleError).toHaveBeenCalled(); // the listener failure is reported, not swallowed silently
    consoleError.mockRestore();
  });

  it("a listener throwing during the flush does not propagate out of an otherwise-successful batch", () => {
    const { scene, ids } = sceneWith(2);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    scene.subscribe(() => {
      throw new Error("listener exploded");
    });

    expect(() => scene.batch(() => scene.updateElement(ids[0]!, { x: 2 }))).not.toThrow();
    expect(scene.getElement(ids[0]!)?.x).toBe(2);
    consoleError.mockRestore();
  });

  it("does not notify for a batch that mutated nothing", () => {
    const { scene } = sceneWith(2);
    const listener = vi.fn();
    scene.subscribe(listener);

    scene.batch(() => {
      scene.getElements();
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("returns the callback's value", () => {
    const { scene } = sceneWith(1);
    expect(scene.batch(() => "result")).toBe("result");
  });

  it("leaves the scene notifying normally after a batch (no stuck suppression)", () => {
    const { scene, ids } = sceneWith(2);
    const listener = vi.fn();
    scene.subscribe(listener);

    scene.batch(() => scene.updateElement(ids[0]!, { x: 1 }));
    listener.mockClear();
    scene.updateElement(ids[1]!, { x: 2 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is not left suppressed after a throwing batch either", () => {
    const { scene, ids } = sceneWith(2);
    const listener = vi.fn();
    scene.subscribe(listener);

    expect(() => scene.batch(() => { throw new Error("boom"); })).toThrow();
    listener.mockClear();
    scene.updateElement(ids[0]!, { x: 3 });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
