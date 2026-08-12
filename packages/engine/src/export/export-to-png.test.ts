import type { Drawable } from "roughjs/bin/core";
import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { ImageDecodeCache } from "../images/image-decode-cache";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import type { RenderSceneContext2D } from "../render/render-scene-to-canvas";
import type { RoughCanvasDrawer } from "../render/rough-renderer";
import { Scene } from "../scene/scene";
import { serializeScene } from "../persistence/serialize-scene";
import { EmptyExportSelectionError } from "./export-geometry";
import { exportToPng, readEmbeddedSceneData, SCENE_DATA_PNG_KEYWORD } from "./export-to-png";
import type { CreateExportRenderTarget } from "./export-to-png";
import { readTextChunk } from "./png-chunk-writer";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function asciiBytes(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}
/** Minimal well-formed PNG fixture — see `png-chunk-writer.test.ts` for the same shape. */
function fixturePngBytes(): Uint8Array {
  const ihdrData = [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0];
  const ihdrChunk = [...u32be(ihdrData.length), ...asciiBytes("IHDR"), ...ihdrData, ...u32be(0)];
  const idatChunk = [...u32be(0), ...asciiBytes("IDAT"), ...u32be(0)];
  const iendChunk = [...u32be(0), ...asciiBytes("IEND"), ...u32be(0)];
  return new Uint8Array([...SIGNATURE, ...ihdrChunk, ...idatChunk, ...iendChunk]);
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
    measureText: vi.fn(() => ({ width: 0, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 })),
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

interface RenderTargetCall {
  pixelWidth: number;
  pixelHeight: number;
  ctx: RenderSceneContext2D;
  roughCanvas: RoughCanvasDrawer;
}

function fakeCreateRenderTarget(calls: RenderTargetCall[]): CreateExportRenderTarget {
  return (pixelWidth, pixelHeight) => {
    const ctx = fakeRenderSceneContext();
    const roughCanvas = fakeRoughCanvas();
    calls.push({ pixelWidth, pixelHeight, ctx, roughCanvas });
    return {
      ctx,
      roughCanvas,
      toBlob: async () => new Blob([fixturePngBytes() as Uint8Array<ArrayBuffer>], { type: "image/png" }),
    };
  };
}

function baseOptions(scene: Scene, calls: RenderTargetCall[]) {
  return {
    scene,
    createRenderTarget: fakeCreateRenderTarget(calls),
    textMeasurer: createFixedWidthTextMeasurer(6),
    imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(() => new Promise(() => {})),
  };
}

describe("exportToPng", () => {
  it("renders the scene's elements through the injected render target's context/roughCanvas pair", async () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const calls: RenderTargetCall[] = [];
    const options = baseOptions(scene, calls);

    await exportToPng(options);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.roughCanvas.rectangle).toHaveBeenCalledTimes(1);
    expect(calls[0]!.ctx.clearRect).toHaveBeenCalledTimes(1);
  });

  it("sizes the render target to bounds + padding at 1x scale by default", async () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const calls: RenderTargetCall[] = [];
    await exportToPng(baseOptions(scene, calls));

    // Default padding (16 on each side): 100 + 32 = 132, 50 + 32 = 82.
    expect(calls[0]).toMatchObject({ pixelWidth: 132, pixelHeight: 82 });
  });

  it("scales the render target's pixel dimensions by the requested scale factor", async () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50, }));
    const calls: RenderTargetCall[] = [];
    await exportToPng({ ...baseOptions(scene, calls), scale: 2, padding: 0 });

    expect(calls[0]).toMatchObject({ pixelWidth: 200, pixelHeight: 100 });
  });

  it("paints a solid background fill before the scene when backgroundColor is provided", async () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const calls: RenderTargetCall[] = [];
    await exportToPng({ ...baseOptions(scene, calls), backgroundColor: "#ffffff" });

    expect(calls[0]!.ctx.fillRect).toHaveBeenCalled();
  });

  it("leaves the canvas transparent (no fillRect) when backgroundColor is omitted/null", async () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const calls: RenderTargetCall[] = [];
    await exportToPng(baseOptions(scene, calls));

    expect(calls[0]!.ctx.fillRect).not.toHaveBeenCalled();
  });

  it("exports only the given selection subset, sizing bounds to the selection instead of the whole scene", async () => {
    const scene = new Scene();
    const selected = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.addElement(createRectangleElement({ x: 1000, y: 1000, width: 10, height: 10 })); // not selected, must not affect bounds
    const calls: RenderTargetCall[] = [];
    await exportToPng({ ...baseOptions(scene, calls), elements: [selected], padding: 0 });

    expect(calls[0]).toMatchObject({ pixelWidth: 10, pixelHeight: 10 });
  });

  it("throws EmptyExportSelectionError for an empty scene", async () => {
    const scene = new Scene();
    await expect(exportToPng(baseOptions(scene, []))).rejects.toThrow(EmptyExportSelectionError);
  });

  it("embeds the live scene JSON as a tEXt chunk by default, recoverable via readEmbeddedSceneData", async () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const blob = await exportToPng(baseOptions(scene, []));
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const embedded = readEmbeddedSceneData(bytes);
    expect(embedded).not.toBeNull();
    expect(JSON.parse(embedded!)).toEqual(serializeScene(scene));
  });

  it("does not embed scene data when embedSceneData is false — output equals the raw render target blob", async () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const blob = await exportToPng({ ...baseOptions(scene, []), embedSceneData: false });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(readTextChunk(bytes, SCENE_DATA_PNG_KEYWORD)).toBeNull();
    expect(bytes).toEqual(fixturePngBytes());
  });

  it("embedded scene data survives a multi-byte Unicode text element (base64/UTF-8 round trip)", async () => {
    const scene = new Scene();
    // A Latin-1-illegal character (outside 0-255) would throw if `exportToPng` handed the raw JSON
    // straight to the PNG tEXt chunk writer instead of base64-encoding it first.
    const textElement = scene.addElement(createTextElement({ x: 0, y: 0, text: "héllo 世界 🎨" }));
    const blob = await exportToPng(baseOptions(scene, []));
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const embedded = JSON.parse(readEmbeddedSceneData(bytes)!);
    const restoredText = embedded.elements.find((el: { id: string }) => el.id === textElement.id);
    expect(restoredText.text).toBe("héllo 世界 🎨");
  });
});
