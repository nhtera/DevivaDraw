/**
 * Shared fakes for the two `exportToPng` spec files — a render target that records what it was
 * handed, a rough.js stand-in, and a minimal well-formed PNG for the embed step to rewrite.
 * Extracted so neither spec file owns the harness (and so both stay near the house line limit).
 */
import type { Drawable } from "roughjs/bin/core";
import { vi } from "vitest";
import { ImageDecodeCache } from "../images/image-decode-cache";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import type { RenderSceneContext2D } from "../render/render-scene-to-canvas";
import type { RoughCanvasDrawer } from "../render/rough-renderer";
import { Scene } from "../scene/scene";
import type { CreateExportRenderTarget } from "./export-to-png";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function asciiBytes(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}
/** Minimal well-formed PNG fixture — see `png-chunk-writer.test.ts` for the same shape. */
export function fixturePngBytes(): Uint8Array {
  const ihdrData = [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0];
  const ihdrChunk = [...u32be(ihdrData.length), ...asciiBytes("IHDR"), ...ihdrData, ...u32be(0)];
  const idatChunk = [...u32be(0), ...asciiBytes("IDAT"), ...u32be(0)];
  const iendChunk = [...u32be(0), ...asciiBytes("IEND"), ...u32be(0)];
  return new Uint8Array([...SIGNATURE, ...ihdrChunk, ...idatChunk, ...iendChunk]);
}

export function fakeRenderSceneContext(): RenderSceneContext2D {
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
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
    drawImage: vi.fn(), scale: vi.fn(),
    roundRect: vi.fn(),
    stroke: vi.fn(),
  };
}

export function fakeRoughCanvas(): RoughCanvasDrawer {
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

export interface RenderTargetCall {
  pixelWidth: number;
  pixelHeight: number;
  ctx: RenderSceneContext2D;
  roughCanvas: RoughCanvasDrawer;
}

export function fakeCreateRenderTarget(calls: RenderTargetCall[]): CreateExportRenderTarget {
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

export function baseOptions(scene: Scene, calls: RenderTargetCall[]) {
  return {
    scene,
    createRenderTarget: fakeCreateRenderTarget(calls),
    textMeasurer: createFixedWidthTextMeasurer(6),
    imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(() => new Promise(() => {})),
  };
}
