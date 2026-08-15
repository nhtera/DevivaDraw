import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { AUTOSAVE_RECOVERY_KEY_SUFFIX, AUTOSAVE_STORAGE_KEY, restoreAutosave, startAutosave } from "./local-storage-autosave";
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

describe("restoreAutosave — salvage and recovery backup", () => {
  const RECOVERY_KEY = AUTOSAVE_STORAGE_KEY + AUTOSAVE_RECOVERY_KEY_SUFFIX;

  /** A valid saved document with `mutate` applied to it before it goes back into storage. */
  function savedDocumentWith(mutate: (document: { elements: Record<string, unknown>[] }) => void): string {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.addElement(createRectangleElement({ x: 50, y: 50, width: 10, height: 10 }));
    const storage = fakeStorage();
    const controller = startAutosave({ scene, storage });
    controller.flush();
    controller.dispose();
    const document = JSON.parse(storage.getItem(AUTOSAVE_STORAGE_KEY)!) as { elements: Record<string, unknown>[] };
    mutate(document);
    return JSON.stringify(document);
  }

  it("salvages the valid elements when one element is corrupted, instead of dropping the whole board", () => {
    const raw = savedDocumentWith((document) => {
      document.elements[0]!.width = "corrupted";
    });
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw });
    const onSalvage = vi.fn();

    const restored = restoreAutosave(storage, AUTOSAVE_STORAGE_KEY, { onSalvage });

    expect(restored).not.toBeNull();
    expect(restored!.getElements()).toHaveLength(1);
    expect(onSalvage).toHaveBeenCalledTimes(1);
    expect(onSalvage.mock.calls[0]![0].droppedErrors).toEqual([expect.stringContaining("elements[0].width")]);
  });

  it("backs up the original payload to the recovery key before salvaging", () => {
    const raw = savedDocumentWith((document) => {
      document.elements[0]!.width = "corrupted";
    });
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw });

    restoreAutosave(storage);

    expect(storage.getItem(RECOVERY_KEY)).toBe(raw);
  });

  it("backs up (and reports via onSalvage) an unparsable payload even though nothing is restorable", () => {
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: "{not valid json" });
    const onSalvage = vi.fn();

    expect(restoreAutosave(storage, AUTOSAVE_STORAGE_KEY, { onSalvage })).toBeNull();

    expect(storage.getItem(RECOVERY_KEY)).toBe("{not valid json");
    expect(onSalvage).toHaveBeenCalledTimes(1);
  });

  it("backs up a payload whose envelope is beyond salvage (wrong document type)", () => {
    const raw = JSON.stringify({ not: "a scene document" });
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw });
    const onSalvage = vi.fn();

    expect(restoreAutosave(storage, AUTOSAVE_STORAGE_KEY, { onSalvage })).toBeNull();

    expect(storage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(onSalvage.mock.calls[0]![0].droppedErrors).toHaveLength(1);
  });

  it("does not touch the recovery key or call onSalvage on a clean restore", () => {
    const raw = savedDocumentWith(() => {});
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw });
    const onSalvage = vi.fn();

    const restored = restoreAutosave(storage, AUTOSAVE_STORAGE_KEY, { onSalvage });

    expect(restored!.getElements()).toHaveLength(2);
    expect(storage.getItem(RECOVERY_KEY)).toBeNull();
    expect(onSalvage).not.toHaveBeenCalled();
  });

  it("never clobbers a different payload already parked in the recovery slot, and reports backedUp: false", () => {
    const raw = savedDocumentWith((document) => {
      document.elements[0]!.width = "corrupted";
    });
    const olderBackup = '{"type":"devivadraw/scene","from":"an earlier corruption event"}';
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw, [RECOVERY_KEY]: olderBackup });
    const onSalvage = vi.fn();

    const restored = restoreAutosave(storage, AUTOSAVE_STORAGE_KEY, { onSalvage });

    expect(restored).not.toBeNull();
    expect(storage.getItem(RECOVERY_KEY)).toBe(olderBackup);
    expect(onSalvage.mock.calls[0]![0].backedUp).toBe(false);
  });

  it("re-writing the recovery slot with the SAME payload (a repeat boot) still counts as backed up", () => {
    const raw = savedDocumentWith((document) => {
      document.elements[0]!.width = "corrupted";
    });
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw, [RECOVERY_KEY]: raw });
    const onSalvage = vi.fn();

    expect(restoreAutosave(storage, AUTOSAVE_STORAGE_KEY, { onSalvage })).not.toBeNull();
    expect(onSalvage.mock.calls[0]![0].backedUp).toBe(true);
  });

  it("restores an empty (not null) scene when every element is corrupted but the envelope is intact", () => {
    const raw = savedDocumentWith((document) => {
      for (const element of document.elements) element.width = "corrupted";
    });
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw });
    const onSalvage = vi.fn();

    const restored = restoreAutosave(storage, AUTOSAVE_STORAGE_KEY, { onSalvage });

    expect(restored).not.toBeNull();
    expect(restored!.getElements()).toHaveLength(0);
    expect(onSalvage.mock.calls[0]![0].droppedErrors).toHaveLength(2);
  });

  it("drops a corrupted appState (view state only) while keeping every element", () => {
    const raw = savedDocumentWith((document) => {
      (document as Record<string, unknown>).appState = { zoom: "corrupted" };
    });
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw });
    const onSalvage = vi.fn();

    const restored = restoreAutosave(storage, AUTOSAVE_STORAGE_KEY, { onSalvage });

    expect(restored!.getElements()).toHaveLength(2);
    expect(onSalvage.mock.calls[0]![0].droppedErrors).toEqual([expect.stringContaining("appState.zoom")]);
  });

  it("keeps an image element whose corrupted file entry was dropped (renders as a missing-file placeholder, not a crash)", () => {
    const raw = savedDocumentWith((document) => {
      document.elements.push({
        ...structuredClone(document.elements[0]!),
        id: "image-1",
        type: "image",
        fileId: "file-1",
        naturalWidth: 100,
        naturalHeight: 100,
      });
      (document as Record<string, unknown>).files = { "file-1": { mimeType: "image/png" } }; // missing dataURL/createdAt → dropped
    });
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw });

    const restored = restoreAutosave(storage);

    expect(restored).not.toBeNull();
    expect(restored!.getElement("image-1")).toBeDefined();
    expect(restored!.getFile("file-1")).toBeUndefined();
  });

  it("still salvages when the recovery-key backup write itself fails (quota)", () => {
    const raw = savedDocumentWith((document) => {
      document.elements[0]!.width = "corrupted";
    });
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw });
    storage.setItem = () => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    };

    const restored = restoreAutosave(storage);

    expect(restored).not.toBeNull();
    expect(restored!.getElements()).toHaveLength(1);
  });

  it("cleans up references dangling at a salvaged-away element (arrow binding survives as unbound)", () => {
    const raw = savedDocumentWith((document) => {
      const [first, second] = document.elements as [Record<string, unknown>, Record<string, unknown>];
      document.elements.push({
        ...structuredClone(first),
        id: "arrow-1",
        type: "arrow",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        startBinding: { elementId: first.id, focus: 0, gap: 4 },
        endBinding: { elementId: second.id, focus: 0, gap: 4 },
        startArrowhead: "none",
        endArrowhead: "arrow",
        arrowType: "straight",
      });
      first.width = "corrupted"; // the arrow's start target gets dropped by salvage
    });
    const storage = fakeStorage({ [AUTOSAVE_STORAGE_KEY]: raw });

    const restored = restoreAutosave(storage);

    expect(restored).not.toBeNull();
    const arrow = restored!.getElement("arrow-1");
    expect(arrow).toBeDefined();
    expect((arrow as { startBinding: unknown }).startBinding).toBeNull();
    expect((arrow as { endBinding: { elementId: string } }).endBinding).not.toBeNull();
  });
});
