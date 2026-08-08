import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { expandToGroupMembers, groupSelection, ungroupSelection } from "./group-ungroup";

function seed(scene: Scene, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(scene.addElement(createRectangleElement({ x: i, y: 0, width: 10, height: 10 })).id);
  return ids;
}

describe("groupSelection", () => {
  it("assigns the same new outermost group id to every member", () => {
    const scene = new Scene();
    const ids = seed(scene, 3);
    const groupId = groupSelection(scene, ids);
    expect(groupId).toBeTruthy();
    for (const id of ids) expect(scene.getElement(id)?.groupIds[0]).toBe(groupId);
  });

  it("nests: grouping an already-grouped subset prepends a new outer group instead of flattening", () => {
    const scene = new Scene();
    const ids = seed(scene, 2);
    const innerGroup = groupSelection(scene, ids)!;
    const thirdId = scene.addElement(createRectangleElement({ x: 100, y: 0, width: 10, height: 10 })).id;
    const outerGroup = groupSelection(scene, [...ids, thirdId])!;

    expect(scene.getElement(ids[0]!)?.groupIds).toEqual([outerGroup, innerGroup]);
    expect(scene.getElement(thirdId)?.groupIds).toEqual([outerGroup]);
  });

  it("returns null and does nothing for fewer than 2 elements", () => {
    const scene = new Scene();
    const [id] = seed(scene, 1);
    expect(groupSelection(scene, [id!])).toBeNull();
    expect(scene.getElement(id!)?.groupIds).toEqual([]);
  });
});

describe("ungroupSelection", () => {
  it("removes only the outermost group id", () => {
    const scene = new Scene();
    const ids = seed(scene, 2);
    const inner = groupSelection(scene, ids)!;
    const thirdId = seed(scene, 1)[0]!;
    groupSelection(scene, [...ids, thirdId]);

    ungroupSelection(scene, ids);
    for (const id of ids) expect(scene.getElement(id)?.groupIds).toEqual([inner]);
  });

  it("leaves ungrouped elements untouched", () => {
    const scene = new Scene();
    const [id] = seed(scene, 1);
    expect(() => ungroupSelection(scene, [id!])).not.toThrow();
    expect(scene.getElement(id!)?.groupIds).toEqual([]);
  });
});

describe("expandToGroupMembers", () => {
  it("expands a single grouped id to every member sharing its outermost group", () => {
    const scene = new Scene();
    const ids = seed(scene, 3);
    groupSelection(scene, ids);
    expect(expandToGroupMembers(scene, [ids[0]!]).sort()).toEqual([...ids].sort());
  });

  it("passes through ungrouped ids unchanged", () => {
    const scene = new Scene();
    const [id] = seed(scene, 1);
    expect(expandToGroupMembers(scene, [id!])).toEqual([id]);
  });
});
