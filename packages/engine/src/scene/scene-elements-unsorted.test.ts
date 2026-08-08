import { beforeEach, describe, expect, it } from "vitest";
import { createGenericElement } from "../elements/element-types";
import { Scene } from "./scene";

describe("Scene.elementsUnsorted", () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene();
  });

  it("yields every element exactly once, independent of z-order", () => {
    const a = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const b = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const c = scene.addElement(createGenericElement({ x: 0, y: 0 }));

    const unsortedIds = [...scene.elementsUnsorted()].map((el) => el.id).sort();
    expect(unsortedIds).toEqual([a.id, b.id, c.id].sort());
  });

  it("reflects updates (same id, latest data) without needing a sort", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    scene.updateElement(created.id, { x: 99 });

    const [onlyElement] = [...scene.elementsUnsorted()];
    expect(onlyElement?.id).toBe(created.id);
    expect(onlyElement?.x).toBe(99);
  });

  it("includes soft-deleted elements, same as getElements (filtering is a consumer's responsibility)", () => {
    const created = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    scene.deleteElement(created.id);

    const [onlyElement] = [...scene.elementsUnsorted()];
    expect(onlyElement?.isDeleted).toBe(true);
  });

  it("returns a fresh iterator on every call", () => {
    scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const first = [...scene.elementsUnsorted()];
    scene.addElement(createGenericElement({ x: 0, y: 0 }));
    const second = [...scene.elementsUnsorted()];

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
  });
});
