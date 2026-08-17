import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { serializeScene } from "../persistence/serialize-scene";
import { EmptyExportSelectionError } from "./export-geometry";
import { exportToPng, readEmbeddedSceneData, SCENE_DATA_PNG_KEYWORD } from "./export-to-png";
import { readTextChunk } from "./png-chunk-writer";
import { baseOptions, fixturePngBytes } from "./export-to-png-fixtures";
import type { RenderTargetCall } from "./export-to-png-fixtures";

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

/**
 * An export is a one-shot render: it draws once, synchronously, and encodes the result immediately.
 * The live canvas can afford to draw a placeholder and repaint when a decode lands — a file has no
 * second frame, so anything still in flight is what the user ends up with. This is what stopped a
 * board full of photographs from exporting as a grid of grey boxes.
 */
