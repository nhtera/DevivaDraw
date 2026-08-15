import { afterEach, describe, expect, it, vi } from "vitest";
import { PageStore } from "../pages/page-store";
import { startBrowserDocumentAutosave } from "./scene-file-operations";

/**
 * The camera leg of the document autosave: a session that only pans/zooms mutates no scene, so the
 * writer must both schedule on camera changes and capture the live camera at write time — otherwise
 * a reload reopens at the origin even though the user left the board somewhere specific.
 */

function memoryLocalStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startBrowserDocumentAutosave camera capture", () => {
  it("a camera-only change schedules a debounced write that carries the live camera", () => {
    vi.useFakeTimers();
    const storage = memoryLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });

    const store = PageStore.fresh();
    let camera = { scrollX: 0, scrollY: 0, zoom: 1 };
    const cameraListeners = new Set<() => void>();

    const controller = startBrowserDocumentAutosave(store, store.getActiveScene(), undefined, {
      getCamera: () => camera,
      subscribe: (listener) => {
        cameraListeners.add(listener);
        return () => cameraListeners.delete(listener);
      },
    });

    // Pure pan/zoom: no scene mutation, only the camera store fires.
    camera = { scrollX: -250, scrollY: 90, zoom: 2 };
    for (const listener of cameraListeners) listener();
    expect(storage.data.size).toBe(0); // debounced, not immediate
    vi.advanceTimersByTime(1100);

    expect(storage.data.size).toBe(1);
    const written = JSON.parse([...storage.data.values()][0]!) as { pages: { scene: { appState?: unknown } }[] };
    expect(written.pages[0]!.scene.appState).toMatchObject({ scrollX: -250, scrollY: 90, zoom: 2 });

    controller.dispose();
    camera = { scrollX: 1, scrollY: 1, zoom: 1 };
    for (const listener of cameraListeners) listener();
    expect(cameraListeners.size).toBe(0); // dispose unsubscribed the camera leg too
  });
});
