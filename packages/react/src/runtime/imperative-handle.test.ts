import {
  createCamera,
  createFixedWidthTextMeasurer,
  createRectangleElement,
  createRoughGenerator,
  HistoryStack,
  ImageDecodeCache,
  PanZoomTool,
  Scene,
  SelectionState,
} from "@deviva-draw/engine";
import type { AnyElement, RenderSceneContext2D, RoughCanvasDrawer } from "@deviva-draw/engine";
import { describe, expect, it, vi } from "vitest";
import { buildImperativeHandle } from "./imperative-handle";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function asciiBytes(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}
/** Minimal well-formed PNG fixture, matching `@deviva-draw/engine`'s own `png-chunk-writer.test.ts` fixture shape — needed because `exportToPng` embeds a scene-data `tEXt` chunk into whatever bytes the injected `toBlob()` returns. */
function fixturePngBytes(): Uint8Array {
  const ihdrData = [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0];
  const ihdrChunk = [...u32be(ihdrData.length), ...asciiBytes("IHDR"), ...ihdrData, ...u32be(0)];
  const idatChunk = [...u32be(0), ...asciiBytes("IDAT"), ...u32be(0)];
  const iendChunk = [...u32be(0), ...asciiBytes("IEND"), ...u32be(0)];
  return new Uint8Array([...PNG_SIGNATURE, ...ihdrChunk, ...idatChunk, ...iendChunk]);
}

function fakeRenderSceneContext(): RenderSceneContext2D {
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    strokeStyle: "",
    lineWidth: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    roundRect: vi.fn(),
    stroke: vi.fn(),
  };
}

function fakeRoughCanvas(): RoughCanvasDrawer {
  const dummy = { shape: "rectangle", options: {}, sets: [] } as unknown as ReturnType<RoughCanvasDrawer["rectangle"]>;
  return { rectangle: vi.fn(() => dummy), ellipse: vi.fn(() => dummy), polygon: vi.fn(() => dummy), linearPath: vi.fn(() => dummy), path: vi.fn(() => dummy), draw: vi.fn() };
}

function buildDeps(scene: Scene) {
  return {
    scene,
    selection: new SelectionState(),
    history: new HistoryStack<AnyElement[]>(scene.getElements()),
    panZoomTool: new PanZoomTool({
      getCamera: () => createCamera(),
      setCamera: vi.fn(),
      getViewportSize: () => ({ width: 800, height: 600 }),
      getSceneBounds: () => null,
    }),
    createExportRenderTarget: () => ({
      ctx: fakeRenderSceneContext(),
      roughCanvas: fakeRoughCanvas(),
      // Test fixture bytes are always freshly `new Uint8Array(...)`-backed (never a SharedArrayBuffer
      // view) — same narrowing `@deviva-draw/engine`'s `export-to-png.ts` documents for the identical gap.
      toBlob: async () => new Blob([fixturePngBytes() as Uint8Array<ArrayBuffer>], { type: "image/png" }),
    }),
    // Real (headless) rough.js generator, same as `@deviva-draw/engine`'s own `export-to-svg.test.ts` —
    // no `<canvas>`/DOM needed for SVG-mode path generation.
    createRoughSvgGenerator: () => createRoughGenerator(),
    textMeasurer: createFixedWidthTextMeasurer(8),
    imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(async () => ({ naturalWidth: 10, naturalHeight: 10 }) as HTMLImageElement),
  };
}

describe("buildImperativeHandle — against a real Scene", () => {
  it("getSceneElements returns only non-deleted elements", () => {
    const scene = new Scene();
    const kept = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const removed = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.deleteElement(removed.id);

    const handle = buildImperativeHandle(buildDeps(scene));

    expect(handle.getSceneElements().map((el) => el.id)).toEqual([kept.id]);
  });

  it("getFiles returns only files referenced by a live image element", () => {
    const scene = new Scene();
    scene.addFile("orphan", { mimeType: "image/png", dataURL: "data:x", createdAt: 0 });

    const handle = buildImperativeHandle(buildDeps(scene));

    expect(handle.getFiles()).toEqual({});
  });

  it("resetScene clears every element and prunes orphaned files, batched as one undo step", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const deps = buildDeps(scene);
    const handle = buildImperativeHandle(deps);

    handle.resetScene();

    expect(scene.getElements()).toHaveLength(0);
    expect(deps.history.canUndo()).toBe(true);
  });

  it("resetScene followed by undo restores the original elements", () => {
    const scene = new Scene();
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const deps = buildDeps(scene);
    const handle = buildImperativeHandle(deps);

    handle.resetScene();
    handle.undo();

    expect(scene.getElement(el.id)).toBeDefined();
  });

  it("undo/redo round-trip a real mutation via the same HistoryStack the app's tools push to", () => {
    const scene = new Scene();
    const deps = buildDeps(scene);
    const handle = buildImperativeHandle(deps);
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    deps.history.push(scene.getElements());
    scene.deleteElement(el.id);
    deps.history.push(scene.getElements());

    handle.undo();
    expect(scene.getElement(el.id)?.isDeleted).toBe(false);

    handle.redo();
    expect(scene.getElement(el.id)?.isDeleted).toBe(true);
  });

  it("loadSceneDocument replaces the live scene's elements from a valid document and returns true", () => {
    const source = new Scene();
    source.addElement(createRectangleElement({ x: 5, y: 5, width: 20, height: 20 }));
    const document = source.toJSON();

    const target = new Scene();
    const handle = buildImperativeHandle(buildDeps(target));

    const ok = handle.loadSceneDocument(document);

    expect(ok).toBe(true);
    expect(target.getElements()).toHaveLength(1);
    expect(target.getElements()[0]!.x).toBe(5);
  });

  it("loadSceneDocument returns false for invalid input and leaves the live scene untouched", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const handle = buildImperativeHandle(buildDeps(scene));

    const ok = handle.loadSceneDocument({ garbage: true });

    expect(ok).toBe(false);
    expect(scene.getElements()).toHaveLength(1);
  });

  it("exportToPng resolves a Blob using the injected render target", async () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const handle = buildImperativeHandle(buildDeps(scene));

    const blob = await handle.exportToPng();

    expect(blob).toBeInstanceOf(Blob);
  });

  it("exportToSvg returns an <svg> document string", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const handle = buildImperativeHandle(buildDeps(scene));

    const svg = handle.exportToSvg();

    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("zoomToFit delegates to the injected PanZoomTool without throwing on an empty scene", () => {
    const scene = new Scene();
    const handle = buildImperativeHandle(buildDeps(scene));
    expect(() => handle.zoomToFit()).not.toThrow();
  });
});
