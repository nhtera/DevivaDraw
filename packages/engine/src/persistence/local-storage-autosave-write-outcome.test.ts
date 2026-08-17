/**
 * The success half of autosave's outcome reporting (`onWritten`), split from
 * `local-storage-autosave.test.ts` to keep both files near the house line limit.
 *
 * Why it exists at all: a UI warning raised by a failed write can only be *retracted* by evidence
 * that writing works again. Without a success signal, a storage-full banner would be permanent for
 * the rest of the session even after the user freed space — so "reports successes too" is a
 * behavioural guarantee, not an incidental callback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { serializeMultiPageDocument } from "./multi-page-document";
import { startAutosave, writeAutosaveDocument } from "./local-storage-autosave";
import type { StorageLike } from "./local-storage-autosave";

function fakeStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
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

function quotaError(): DOMException {
  return new DOMException("quota exceeded", "QuotaExceededError");
}

function oneRectangle(): Scene {
  const scene = new Scene();
  scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
  return scene;
}

describe("startAutosave — onWritten", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once the debounced write lands, not when the change is made", () => {
    const scene = new Scene();
    const onWritten = vi.fn();
    const controller = startAutosave({ scene, storage: fakeStorage(), debounceMs: 1000, onWritten });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    expect(onWritten).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onWritten).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("stays silent when the write is rejected for quota", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    storage.setItem = () => {
      throw quotaError();
    };
    const onWritten = vi.fn();
    const onQuotaExceeded = vi.fn();
    const controller = startAutosave({ scene, storage, debounceMs: 1000, onWritten, onQuotaExceeded });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    vi.advanceTimersByTime(1000);

    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    expect(onWritten).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("reports the recovery: a write that succeeds after a quota failure fires onWritten", () => {
    const scene = new Scene();
    const storage = fakeStorage();
    const realSetItem = storage.setItem.bind(storage);
    let full = true;
    storage.setItem = (key, value) => {
      if (full) throw quotaError();
      realSetItem(key, value);
    };
    const onWritten = vi.fn();
    const onQuotaExceeded = vi.fn();
    const controller = startAutosave({ scene, storage, debounceMs: 1000, onWritten, onQuotaExceeded });

    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    vi.advanceTimersByTime(1000);
    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);

    full = false; // the user freed space
    scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10 }));
    vi.advanceTimersByTime(1000);

    expect(onWritten).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("flush() reports its own successful write", () => {
    const scene = oneRectangle();
    const onWritten = vi.fn();
    const controller = startAutosave({ scene, storage: fakeStorage(), onWritten });

    controller.flush();

    expect(onWritten).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});

describe("writeAutosaveDocument — outcome reporting", () => {
  const document = () => serializeMultiPageDocument([{ id: "p1", name: "Page 1", scene: oneRectangle() }], { activePageId: "p1" });

  it("fires onWritten when the document lands", () => {
    const onWritten = vi.fn();
    const storage = fakeStorage();

    writeAutosaveDocument(storage, document(), { onWritten });

    expect(onWritten).toHaveBeenCalledTimes(1);
    expect(Object.keys(storage.data)).toHaveLength(1);
  });

  it("fires onQuotaExceeded (and never onWritten) when storage is full", () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw quotaError();
    };
    const onWritten = vi.fn();
    const onQuotaExceeded = vi.fn();

    expect(() => writeAutosaveDocument(storage, document(), { onWritten, onQuotaExceeded })).not.toThrow();

    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    expect(onWritten).not.toHaveBeenCalled();
  });

  it("routes a non-quota failure through onError", () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("disk on fire");
    };
    const onError = vi.fn();
    const onWritten = vi.fn();

    expect(() => writeAutosaveDocument(storage, document(), { onError, onWritten })).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onWritten).not.toHaveBeenCalled();
  });
});
