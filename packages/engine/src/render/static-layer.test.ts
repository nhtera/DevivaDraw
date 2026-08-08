import { describe, expect, it, vi } from "vitest";
import { createGenericElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { createCamera } from "./camera";
import { StaticLayer } from "./static-layer";
import type { StaticLayerContext } from "./static-layer";

function fakeContext(width = 800, height = 600): StaticLayerContext {
  return {
    canvas: { clientWidth: width, clientHeight: height },
    strokeStyle: "",
    lineWidth: 0,
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
  };
}

describe("StaticLayer.render", () => {
  it("draws on the first call: clears once and strokes once per visible element", () => {
    const ctx = fakeContext();
    const scene = new Scene();
    scene.addElement(createGenericElement({ x: 10, y: 10, width: 20, height: 20 }));
    scene.addElement(createGenericElement({ x: 30, y: 30, width: 20, height: 20 }));
    const layer = new StaticLayer(ctx);

    layer.render(scene, createCamera());

    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
  });

  it("skips the redraw entirely when the scene and camera are unchanged since the last render", () => {
    const ctx = fakeContext();
    const scene = new Scene();
    scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 }));
    const layer = new StaticLayer(ctx);
    const camera = createCamera();

    layer.render(scene, camera);
    layer.render(scene, camera);
    layer.render(scene, camera);

    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("redraws when an element is added after the first render", () => {
    const ctx = fakeContext();
    const scene = new Scene();
    scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 }));
    const layer = new StaticLayer(ctx);
    const camera = createCamera();

    layer.render(scene, camera);
    scene.addElement(createGenericElement({ x: 5, y: 5, width: 10, height: 10 }));
    layer.render(scene, camera);

    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1 + 2); // 1 first pass, 2 second pass
  });

  it("redraws when an existing element is updated (version bump) even with an unchanged count", () => {
    const ctx = fakeContext();
    const scene = new Scene();
    const element = scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 }));
    const layer = new StaticLayer(ctx);
    const camera = createCamera();

    layer.render(scene, camera);
    scene.updateElement(element.id, { x: 50 });
    layer.render(scene, camera);

    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
  });

  it("redraws when the camera (pan/zoom) changes but the scene does not", () => {
    const ctx = fakeContext();
    const scene = new Scene();
    scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 }));
    const layer = new StaticLayer(ctx);

    layer.render(scene, createCamera());
    layer.render(scene, createCamera({ scrollX: 25 }));
    layer.render(scene, createCamera({ scrollX: 25, zoom: 2 }));

    expect(ctx.clearRect).toHaveBeenCalledTimes(3);
  });

  it("excludes off-screen elements from the stroke count (culling still applies)", () => {
    const ctx = fakeContext(800, 600);
    const scene = new Scene();
    scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 })); // visible
    scene.addElement(createGenericElement({ x: 5000, y: 5000, width: 10, height: 10 })); // off-screen
    const layer = new StaticLayer(ctx);

    layer.render(scene, createCamera());

    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
  });

  it("invalidate() forces the next render() to redraw even with nothing else changed", () => {
    const ctx = fakeContext();
    const scene = new Scene();
    scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 }));
    const layer = new StaticLayer(ctx);
    const camera = createCamera();

    layer.render(scene, camera);
    layer.render(scene, camera); // skipped
    layer.invalidate();
    layer.render(scene, camera); // forced

    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
  });

  it("never calls the sorted getElements() when a render is skipped (fingerprint uses the unsorted path)", () => {
    const ctx = fakeContext();
    const scene = new Scene();
    scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 }));
    const layer = new StaticLayer(ctx);
    const camera = createCamera();
    const getElementsSpy = vi.spyOn(scene, "getElements");

    layer.render(scene, camera); // redraws: 1 sorted fetch
    layer.render(scene, camera); // skipped: must not touch the sorted path at all
    layer.render(scene, camera); // skipped

    expect(getElementsSpy).toHaveBeenCalledTimes(1);
  });

  it("calls the sorted getElements() exactly once per actual redraw, not once per fingerprint check plus once per draw", () => {
    const ctx = fakeContext();
    const scene = new Scene();
    const element = scene.addElement(createGenericElement({ x: 0, y: 0, width: 10, height: 10 }));
    const layer = new StaticLayer(ctx);
    const camera = createCamera();
    const getElementsSpy = vi.spyOn(scene, "getElements");

    layer.render(scene, camera); // redraw #1
    scene.updateElement(element.id, { x: 5 });
    layer.render(scene, camera); // redraw #2

    expect(getElementsSpy).toHaveBeenCalledTimes(2);
  });
});
