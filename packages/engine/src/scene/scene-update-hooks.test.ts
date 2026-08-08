/**
 * `Scene.registerUpdateHook` coverage — split out from `scene.test.ts` purely to keep both files
 * under the house line-count limit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGenericElement } from "../elements/element-types";
import { Scene } from "./scene";

describe("Scene.registerUpdateHook", () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene();
  });

  it("runs on every updateElement call, receiving the updated element and the scene", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const hook = vi.fn();
    scene.registerUpdateHook(hook);

    scene.updateElement(created.id, { x: 5 });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(expect.objectContaining({ id: created.id, x: 5 }), scene);
  });

  it("does NOT run on addElement — only updateElement (including the soft-delete path) triggers it", () => {
    const hook = vi.fn();
    scene.registerUpdateHook(hook);

    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    expect(hook).not.toHaveBeenCalled();

    scene.deleteElement(created.id); // soft-delete is itself an updateElement call
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]?.[0]).toMatchObject({ isDeleted: true });
  });

  it("does not run for a no-op update of an unknown id", () => {
    const hook = vi.fn();
    scene.registerUpdateHook(hook);
    scene.updateElement("nope", { x: 1 });
    expect(hook).not.toHaveBeenCalled();
  });

  it("a hook that itself calls updateElement (e.g. rerouting a bound arrow) runs to completion without the outer call waiting on it, and does not throw", () => {
    const other = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const trigger = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    let hookRuns = 0;
    scene.registerUpdateHook((updated) => {
      hookRuns += 1;
      if (updated.id === trigger.id && hookRuns < 2) scene.updateElement(other.id, { x: 99 });
    });

    expect(() => scene.updateElement(trigger.id, { x: 1 })).not.toThrow();
    expect(scene.getElement(other.id)?.x).toBe(99);
  });

  it("supports multiple independent hooks, and unregistering one leaves the other active", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = scene.registerUpdateHook(first);
    scene.registerUpdateHook(second);

    scene.updateElement(created.id, { x: 1 });
    unregisterFirst();
    scene.updateElement(created.id, { x: 2 });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("a throwing hook does not prevent a later-registered hook from running, does not skip notify(), and does not propagate to the updateElement caller", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secondHook = vi.fn();
    const listener = vi.fn();
    scene.registerUpdateHook(() => {
      throw new Error("adversarial hook failure");
    });
    scene.registerUpdateHook(secondHook);
    scene.subscribe(listener);

    let result: ReturnType<Scene["updateElement"]>;
    expect(() => {
      result = scene.updateElement(created.id, { x: 42 });
    }).not.toThrow();

    expect(result!).toMatchObject({ id: created.id, x: 42 }); // the mutation itself still landed
    expect(secondHook).toHaveBeenCalledTimes(1); // ran despite the first hook throwing
    expect(listener).toHaveBeenCalledTimes(1); // notify() still fired
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1); // the failure was reported, not silently dropped

    consoleErrorSpy.mockRestore();
  });

  it("a hook that throws every time is reported on every call, never crashing the caller (scene state stays consistent)", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    scene.registerUpdateHook(() => {
      throw new Error("always fails");
    });

    scene.updateElement(created.id, { x: 1 });
    scene.updateElement(created.id, { x: 2 });
    scene.updateElement(created.id, { x: 3 });

    expect(scene.getElement(created.id)?.x).toBe(3); // every mutation still applied cleanly
    expect(consoleErrorSpy).toHaveBeenCalledTimes(3);

    consoleErrorSpy.mockRestore();
  });
});
