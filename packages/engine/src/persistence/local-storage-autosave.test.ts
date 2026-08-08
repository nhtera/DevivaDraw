import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { AUTOSAVE_STORAGE_KEY, restoreAutosave, startAutosave } from "./local-storage-autosave";
import type { StorageLike } from "./local-storage-autosave";

/** In-memory `StorageLike` fake — real `window.localStorage`-shaped, no DOM needed. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key]! : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe("startAutosave — debounced write", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not write immediately on a scene change — waits out the debounce window", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    const controller = startAutosave({ scene, storage, debounceMs: 1000 });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    expect(storage.getItem(AUTOSAVE_STORAGE_KEY)).toBeNull();

    controller.dispose();
  });

  it("writes once the debounce window elapses after the last change", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    const controller = startAutosave({ scene, storage, debounceMs: 1000 });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    vi.advanceTimersByTime(1000);

    const saved = storage.getItem(AUTOSAVE_STORAGE_KEY);
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!).elements).toHaveLength(1);

    controller.dispose();
  });

  it("coalesces a burst of changes into a single write, restarting the debounce timer on each change", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    const setItemSpy = vi.spyOn(storage, "setItem");
    const controller = startAutosave({ scene, storage, debounceMs: 1000 });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    vi.advanceTimersByTime(500);
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    vi.advanceTimersByTime(500); // 1000ms since the first add, but only 500ms since the second — must not have fired yet
    expect(setItemSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500); // now 1000ms since the second (last) change
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem(AUTOSAVE_STORAGE_KEY)!).elements).toHaveLength(2);

    controller.dispose();
  });

  it("flush() writes immediately, canceling any pending debounced write", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    const controller = startAutosave({ scene, storage, debounceMs: 1000 });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    controller.flush();

    expect(storage.getItem(AUTOSAVE_STORAGE_KEY)).not.toBeNull();
    controller.dispose();
  });

  it("dispose() stops listening — a subsequent scene change never triggers a write", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    const controller = startAutosave({ scene, storage, debounceMs: 1000 });
    controller.dispose();

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    vi.advanceTimersByTime(5000);

    expect(storage.getItem(AUTOSAVE_STORAGE_KEY)).toBeNull();
  });

  it("keeps soft-deleted (tombstoned) elements in the autosaved snapshot", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    const controller = startAutosave({ scene, storage, debounceMs: 1000 });

    const element = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.deleteElement(element.id);
    vi.advanceTimersByTime(1000);

    const saved = JSON.parse(storage.getItem(AUTOSAVE_STORAGE_KEY)!);
    expect(saved.elements).toHaveLength(1);
    expect(saved.elements[0].isDeleted).toBe(true);

    controller.dispose();
  });

  it("respects a custom storageKey instead of the default", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    const controller = startAutosave({ scene, storage, debounceMs: 1000, storageKey: "custom-key" });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    vi.advanceTimersByTime(1000);

    expect(storage.getItem("custom-key")).not.toBeNull();
    expect(storage.getItem(AUTOSAVE_STORAGE_KEY)).toBeNull();
    controller.dispose();
  });
});

describe("startAutosave — quota exceeded / write failure handling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls onQuotaExceeded (never throws) when the storage write hits a quota error", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    };
    const onQuotaExceeded = vi.fn();
    const onError = vi.fn();
    const controller = startAutosave({ scene, storage, debounceMs: 1000, onQuotaExceeded, onError });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();

    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("routes a non-quota write failure through onError instead", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("disk on fire");
    };
    const onQuotaExceeded = vi.fn();
    const onError = vi.fn();
    const controller = startAutosave({ scene, storage, debounceMs: 1000, onQuotaExceeded, onError });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onQuotaExceeded).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("flush() also reports (never throws on) a write failure", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    };
    const onQuotaExceeded = vi.fn();
    const controller = startAutosave({ scene, storage, onQuotaExceeded });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    expect(() => controller.flush()).not.toThrow();
    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});

describe("restoreAutosave", () => {
  it("returns null when nothing has been saved", () => {
    expect(restoreAutosave(fakeStorage())).toBeNull();
  });

  it("returns null (never throws) for unparsable JSON", () => {
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: "{not valid json" });
    expect(() => restoreAutosave(storage)).not.toThrow();
    expect(restoreAutosave(storage)).toBeNull();
  });

  it("returns null (never throws) for well-formed JSON that fails schema validation", () => {
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: JSON.stringify({ not: "a scene document" }) });
    expect(restoreAutosave(storage)).toBeNull();
  });

  it("restores a Scene equal to the one that was saved, including soft-deleted tombstones", () => {
    const scene = new Scene();
    const kept = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const deleted = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.deleteElement(deleted.id);

    const storage = fakeStorage();
    const controller = startAutosave({ scene, storage });
    controller.flush();
    controller.dispose();

    const restored = restoreAutosave(storage);
    expect(restored).not.toBeNull();
    expect(restored!.getElements().map((el) => el.id).sort()).toEqual([deleted.id, kept.id].sort());
    expect(restored!.getElement(deleted.id)?.isDeleted).toBe(true);
  });

  it("respects a custom storageKey", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const storage = fakeStorage();
    const controller = startAutosave({ scene, storage, storageKey: "custom-key" });
    controller.flush();
    controller.dispose();

    expect(restoreAutosave(storage, "custom-key")).not.toBeNull();
    expect(restoreAutosave(storage)).toBeNull();
  });
});
