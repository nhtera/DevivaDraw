import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { ImageDecodeCache } from "../images/image-decode-cache";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import type { RenderSceneContext2D } from "../render/render-scene-to-canvas";
import { Scene } from "../scene/scene";
import { copyAsImage } from "./copy-as-image";
import type { CreateExportRenderTarget } from "./export-to-png";

function fakeRenderSceneContext(): RenderSceneContext2D {
  return {
    clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), globalAlpha: 1,
    fillStyle: "", beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    font: "", textAlign: "left", textBaseline: "alphabetic", fillText: vi.fn(), measureText: vi.fn(() => ({ width: 0, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 })),
    strokeStyle: "", lineWidth: 1, fillRect: vi.fn(), strokeRect: vi.fn(), drawImage: vi.fn(), scale: vi.fn(), roundRect: vi.fn(), stroke: vi.fn(),
  };
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function fixturePngBytes(): Uint8Array {
  const ihdrData = [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0];
  return new Uint8Array([
    ...SIGNATURE,
    ...u32be(ihdrData.length), 73, 72, 68, 82, ...ihdrData, ...u32be(0), // IHDR
    ...u32be(0), 73, 68, 65, 84, ...u32be(0), // IDAT
    ...u32be(0), 73, 69, 78, 68, ...u32be(0), // IEND
  ]);
}

function fakeRoughCanvas() {
  return { rectangle: vi.fn(), ellipse: vi.fn(), polygon: vi.fn(), linearPath: vi.fn(), path: vi.fn(), draw: vi.fn() };
}

function fakeCreateRenderTarget(): CreateExportRenderTarget {
  return () => ({
    ctx: fakeRenderSceneContext(),
    roughCanvas: fakeRoughCanvas(),
    toBlob: async () => new Blob([fixturePngBytes() as Uint8Array<ArrayBuffer>], { type: "image/png" }),
  });
}

describe("copyAsImage", () => {
  it("exports the scene to PNG and writes exactly one ClipboardItem built from that blob", async () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));

    const write = vi.fn(async () => {});
    const sentinelClipboardItem = { marker: "clipboard-item" };
    const createClipboardItem = vi.fn<(blob: Blob) => typeof sentinelClipboardItem>(() => sentinelClipboardItem);

    await copyAsImage({
      scene,
      createRenderTarget: fakeCreateRenderTarget(),
      textMeasurer: createFixedWidthTextMeasurer(6),
      imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(() => new Promise(() => {})),
      clipboard: { write },
      createClipboardItem,
    });

    expect(createClipboardItem).toHaveBeenCalledTimes(1);
    const blobArg = createClipboardItem.mock.calls[0]![0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect(write).toHaveBeenCalledWith([sentinelClipboardItem]);
  });

  it("propagates a rejected export instead of writing to the clipboard", async () => {
    const scene = new Scene(); // empty scene -> exportToPng throws EmptyExportSelectionError
    const write = vi.fn(async () => {});

    await expect(
      copyAsImage({
        scene,
        createRenderTarget: fakeCreateRenderTarget(),
        textMeasurer: createFixedWidthTextMeasurer(6),
        imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(() => new Promise(() => {})),
        clipboard: { write },
        createClipboardItem: (blob) => blob,
      }),
    ).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
