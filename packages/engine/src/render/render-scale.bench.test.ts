/**
 * What a big scene costs the render/notification path, as a deterministic gate.
 *
 * The browser benchmark (`apps/web/e2e/perf/scale-benchmark.spec.ts`) produces the published
 * wall-clock numbers; it cannot gate CI, because frame timings on shared hardware are noisy enough
 * that any useful threshold would flap. This file is the half that CAN gate: it asserts *counts*,
 * which are exact and machine-independent, and prints timings for review the way
 * `bindings/binding-highlight.bench.test.ts` already does.
 *
 * The counts pinned here are the ones that made a 10 000-element drag stutter: a subscriber
 * notification per mutated element, and a full redraw per notification. Both are now once per
 * gesture frame regardless of scene size — a regression to per-element behavior fails this file
 * instantly and by an unmistakable margin (1 vs 5 000), with no timing involved.
 */
import type { Drawable } from "roughjs/bin/core";
import { describe, expect, it, vi } from "vitest";
import type { AnyElement } from "../elements/element-types";
import { HistoryStack } from "../history/history-stack";
import { InternalClipboard } from "../selection/clipboard";
import { MoveGesture } from "../selection/selection-move-gesture";
import { SelectionState } from "../selection/selection-state";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { createCamera } from "./camera";
import type { RoughCanvasDrawer } from "./rough-renderer";
import { StaticLayer } from "./static-layer";
import type { StaticLayerContext } from "./static-layer";

const SCALE = 5_000;

function fakeContext(width = 1440, height = 900): StaticLayerContext {
  return {
    canvas: { clientWidth: width, clientHeight: height },
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 })),
    strokeStyle: "",
    lineWidth: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    scale: vi.fn(),
    roundRect: vi.fn(),
    stroke: vi.fn(),
  };
}

function fakeRoughCanvas(): RoughCanvasDrawer {
  const dummyDrawable = { shape: "rectangle", options: {}, sets: [] } as unknown as Drawable;
  return {
    rectangle: vi.fn(() => dummyDrawable),
    ellipse: vi.fn(() => dummyDrawable),
    polygon: vi.fn(() => dummyDrawable),
    linearPath: vi.fn(() => dummyDrawable),
    path: vi.fn(() => dummyDrawable),
    draw: vi.fn(),
  };
}

/** A grid of `count` rectangles spread far wider than any viewport, so culling has real work to do. */
function buildScene(count: number): { scene: Scene; ids: string[] } {
  const scene = new Scene();
  const perRow = Math.ceil(Math.sqrt(count));
  const ids = Array.from({ length: count }, (_, i) => {
    const element = createRectangleElement({ x: (i % perRow) * 180, y: Math.floor(i / perRow) * 180, width: 100, height: 80 });
    return scene.addElement(element).id;
  });
  return { scene, ids };
}

function logMs(label: string, ms: number): void {
  console.log(`render-scale: ${label} -> ${ms.toFixed(2)}ms`);
}

describe(`notification cost of moving a ${SCALE}-element selection`, () => {
  it("dispatches ONE subscriber notification per frame, not one per element", () => {
    const { scene, ids } = buildScene(SCALE);
    const listener = vi.fn();
    scene.subscribe(listener);

    const started = performance.now();
    // Exactly what `selection-move-gesture.ts`'s `apply` does for one pointer move.
    scene.batch(() => {
      for (const id of ids) {
        const element = scene.getElement(id)!;
        scene.updateElement(id, { x: element.x + 3, y: element.y + 2 });
      }
    });
    logMs(`batched move of ${SCALE} elements`, performance.now() - started);

    // The whole point: independent of scene size. A regression to per-element notification makes
    // this 5 000 instead of 1.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("the real move GESTURE batches too — not just the primitive it is built on", () => {
    // The test above proves `Scene.batch` works; this one proves the drag actually uses it. Without
    // it, deleting the `batch(...)` wrapper from `selection-move-gesture.ts` would leave every
    // assertion in this file passing while the stutter came straight back.
    const { scene, ids } = buildScene(SCALE);
    const selection = new SelectionState();
    selection.selectOnly(ids);
    const gesture = new MoveGesture({
      scene,
      selection,
      history: new HistoryStack<AnyElement[]>(scene.getElements()),
      clipboard: new InternalClipboard(),
      getZoom: () => 1,
    });
    expect(gesture.begin({ x: 5, y: 5 }, ids[0]!, { shift: false, alt: false, ctrl: false, meta: false })).toBe(true);

    const listener = vi.fn();
    scene.subscribe(listener);
    const started = performance.now();
    gesture.apply({ x: 35, y: 25 }, { shift: false, alt: false, ctrl: false, meta: false });
    logMs(`one gesture frame moving ${SCALE} elements`, performance.now() - started);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("applies every element's change despite the single notification", () => {
    const { scene, ids } = buildScene(200);
    const before = ids.map((id) => scene.getElement(id)!.x);

    scene.batch(() => {
      for (const id of ids) scene.updateElement(id, { x: scene.getElement(id)!.x + 5 });
    });

    ids.forEach((id, i) => expect(scene.getElement(id)!.x).toBe(before[i]! + 5));
  });
});

describe(`static-layer redraw at ${SCALE} elements`, () => {
  it("draws only what the viewport can show, not the whole scene", () => {
    const { scene } = buildScene(SCALE);
    const roughCanvas = fakeRoughCanvas();
    const layer = new StaticLayer(fakeContext(), roughCanvas);

    const started = performance.now();
    layer.render(scene, createCamera());
    logMs(`first full redraw of ${SCALE} elements`, performance.now() - started);

    const drawn = (roughCanvas.rectangle as ReturnType<typeof vi.fn>).mock.calls.length;
    console.log(`render-scale: drew ${drawn} of ${SCALE} elements (viewport culling)`);
    expect(drawn).toBeGreaterThan(0);
    // Culling must keep the per-frame draw set bounded by the viewport. Generous headroom: this is
    // a "did culling stop working" tripwire, not a tuning threshold.
    expect(drawn).toBeLessThan(SCALE / 4);
  });

  it("skips the redraw entirely when nothing changed — the cache that makes panning cheap", () => {
    const { scene } = buildScene(SCALE);
    const ctx = fakeContext();
    const layer = new StaticLayer(ctx, fakeRoughCanvas());
    const camera = createCamera();

    layer.render(scene, camera);
    const clearsAfterFirst = (ctx.clearRect as ReturnType<typeof vi.fn>).mock.calls.length;
    const started = performance.now();
    for (let i = 0; i < 60; i += 1) layer.render(scene, camera);
    logMs("60 no-op redraws", performance.now() - started);

    expect((ctx.clearRect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(clearsAfterFirst);
  });

  it("redraws once after a batched mutation of the whole scene, not once per element", () => {
    const { scene, ids } = buildScene(SCALE);
    const ctx = fakeContext();
    const layer = new StaticLayer(ctx, fakeRoughCanvas());
    const camera = createCamera();
    // The shell invalidates the layer from a scene subscriber, so notification count IS redraw count.
    scene.subscribe(() => layer.invalidate());

    layer.render(scene, camera);
    const clearsAfterFirst = (ctx.clearRect as ReturnType<typeof vi.fn>).mock.calls.length;

    scene.batch(() => {
      for (const id of ids) scene.updateElement(id, { x: scene.getElement(id)!.x + 1 });
    });
    layer.render(scene, camera);

    expect((ctx.clearRect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(clearsAfterFirst + 1);
  });
});
