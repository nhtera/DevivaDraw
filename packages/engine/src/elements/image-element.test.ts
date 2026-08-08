import { describe, expect, it } from "vitest";
import { createImageElement } from "./image-element";

describe("createImageElement", () => {
  it("builds an image element with the base defaults and correct type discriminant", () => {
    const element = createImageElement({
      x: 5,
      y: 10,
      width: 100,
      height: 50,
      fileId: "file-abc",
      naturalWidth: 400,
      naturalHeight: 200,
    });

    expect(element.type).toBe("image");
    expect(element.x).toBe(5);
    expect(element.y).toBe(10);
    expect(element.width).toBe(100);
    expect(element.height).toBe(50);
    expect(element.fileId).toBe("file-abc");
    expect(element.naturalWidth).toBe(400);
    expect(element.naturalHeight).toBe(200);
    expect(element.opacity).toBe(100); // inherited BaseElement default
    expect(element.version).toBe(0); // store-owned, not yet inserted — see element-factory-defaults.ts
  });

  it("lets width/height diverge from naturalWidth/naturalHeight — independently resizable box vs. immutable intrinsic size", () => {
    const element = createImageElement({ x: 0, y: 0, width: 40, height: 20, fileId: "f1", naturalWidth: 800, naturalHeight: 400 });
    expect(element.width).toBe(40);
    expect(element.height).toBe(20);
    expect(element.naturalWidth).toBe(800);
    expect(element.naturalHeight).toBe(400);
  });

  it("assigns a unique id per call, consistent with every other element factory", () => {
    const a = createImageElement({ x: 0, y: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 });
    const b = createImageElement({ x: 0, y: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 });
    expect(a.id).not.toBe(b.id);
  });
});
