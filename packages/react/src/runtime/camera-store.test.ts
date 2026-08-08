import { createCamera } from "@deviva-draw/engine";
import { describe, expect, it, vi } from "vitest";
import { createCameraStore } from "./camera-store";

describe("createCameraStore", () => {
  it("getCamera returns the initial camera", () => {
    const initial = createCamera({ zoom: 2 });
    const store = createCameraStore(initial);
    expect(store.getCamera()).toBe(initial);
  });

  it("setCamera updates getCamera's return value", () => {
    const store = createCameraStore(createCamera());
    const next = createCamera({ zoom: 3 });
    store.setCamera(next);
    expect(store.getCamera()).toBe(next);
  });

  it("notifies subscribers when scrollX/scrollY/zoom actually change", () => {
    const store = createCameraStore(createCamera());
    const listener = vi.fn();
    store.subscribe(listener);

    store.setCamera(createCamera({ zoom: 1.5 }));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify for a value-identical camera (a new object with the same scrollX/scrollY/zoom)", () => {
    const store = createCameraStore(createCamera({ scrollX: 5, scrollY: 5, zoom: 1 }));
    const listener = vi.fn();
    store.subscribe(listener);

    store.setCamera({ scrollX: 5, scrollY: 5, zoom: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const store = createCameraStore(createCamera());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.setCamera(createCamera({ zoom: 2 }));

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple independent subscribers", () => {
    const store = createCameraStore(createCamera());
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe(first);
    store.subscribe(second);

    store.setCamera(createCamera({ scrollX: 1 }));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
