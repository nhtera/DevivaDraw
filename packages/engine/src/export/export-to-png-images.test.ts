/**
 * An export is a one-shot render: it draws once, synchronously, and encodes the result immediately.
 * The live canvas can afford to draw a placeholder and repaint when a decode lands — a file has no
 * second frame, so anything still in flight is what the user ends up with. This is what stopped a
 * board full of photographs from exporting as a grid of grey boxes.
 */
import { describe, expect, it, vi } from "vitest";
import { createImageElement } from "../elements/image-element";
import { ImageDecodeCache } from "../images/image-decode-cache";
import { Scene } from "../scene/scene";
import { exportToPng } from "./export-to-png";
import { baseOptions } from "./export-to-png-fixtures";
import type { RenderTargetCall } from "./export-to-png-fixtures";

describe("exportToPng — image decoding", () => {
  const fakeImage = { width: 10, height: 10 } as HTMLImageElement;

  function sceneWithImage(): Scene {
    const scene = new Scene();
    scene.addFile("f1", { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", createdAt: 1 });
    scene.addElement(createImageElement({ x: 0, y: 0, width: 20, height: 20, fileId: "f1", naturalWidth: 10, naturalHeight: 10 }));
    return scene;
  }

  it("waits for the image to decode, then draws it", async () => {
    const scene = sceneWithImage();
    const calls: RenderTargetCall[] = [];
    // Resolves a turn later, exactly like a real decode: without the wait, the render has already run.
    const decode = vi.fn(async () => {
      await Promise.resolve();
      return fakeImage;
    });

    await exportToPng({ ...baseOptions(scene, calls), imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(decode), padding: 0 });

    expect(decode).toHaveBeenCalledTimes(1);
    expect(calls[0]!.ctx.drawImage).toHaveBeenCalled();
  });

  it("still produces a file when the image cannot be decoded at all", async () => {
    const scene = sceneWithImage();
    const calls: RenderTargetCall[] = [];
    const cache = new ImageDecodeCache<HTMLImageElement>(() => Promise.reject(new Error("corrupt")));

    const blob = await exportToPng({ ...baseOptions(scene, calls), imageDecodeCache: cache, padding: 0 });

    expect(blob.size).toBeGreaterThan(0);
    expect(calls[0]!.ctx.drawImage).not.toHaveBeenCalled();
  });

  it("decodes a file shared by several elements once", async () => {
    const scene = sceneWithImage();
    scene.addElement(createImageElement({ x: 40, y: 0, width: 20, height: 20, fileId: "f1", naturalWidth: 10, naturalHeight: 10 }));
    const calls: RenderTargetCall[] = [];
    const decode = vi.fn(() => Promise.resolve(fakeImage));

    await exportToPng({ ...baseOptions(scene, calls), imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(decode), padding: 0 });

    expect(decode).toHaveBeenCalledTimes(1);
  });
});
