import { describe, expect, it } from "vitest";
import { createGenericElement } from "./element-types";

describe("createGenericElement", () => {
  it("fills in required fields and sane defaults", () => {
    const element = createGenericElement({ x: 10, y: 20 });

    expect(element.type).toBe("generic");
    expect(element.x).toBe(10);
    expect(element.y).toBe(20);
    expect(element.width).toBe(0);
    expect(element.height).toBe(0);
    expect(element.strokeColor).toBe("#1e1e1e");
    expect(element.backgroundColor).toBe("transparent");
    expect(element.fillStyle).toBe("solid");
    expect(element.strokeStyle).toBe("solid");
    expect(element.opacity).toBe(100);
    expect(element.roundness).toBeNull();
    expect(element.groupIds).toEqual([]);
    expect(element.frameId).toBeNull();
    expect(element.boundElements).toBeNull();
    expect(element.link).toBeNull();
    expect(element.locked).toBe(false);
    expect(element.isDeleted).toBe(false);
  });

  it("assigns a unique id per call", () => {
    const a = createGenericElement({ x: 0, y: 0 });
    const b = createGenericElement({ x: 0, y: 0 });
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThan(0);
  });

  it("lets the caller override any default", () => {
    const element = createGenericElement({
      x: 1,
      y: 2,
      width: 100,
      height: 50,
      strokeColor: "#ff0000",
      locked: true,
      groupIds: ["group-1"],
    });

    expect(element.width).toBe(100);
    expect(element.height).toBe(50);
    expect(element.strokeColor).toBe("#ff0000");
    expect(element.locked).toBe(true);
    expect(element.groupIds).toEqual(["group-1"]);
  });

  it("leaves store-owned fields at their pre-insert sentinels", () => {
    // version/versionNonce/updated/index are only ever set by Scene.addElement via touch() —
    // see scene/scene-mutations.ts. A freshly-created element must not look "already tracked".
    const element = createGenericElement({ x: 0, y: 0 });
    expect(element.version).toBe(0);
    expect(element.versionNonce).toBe(0);
    expect(element.updated).toBe(0);
    expect(element.index).toBe("");
  });
});
