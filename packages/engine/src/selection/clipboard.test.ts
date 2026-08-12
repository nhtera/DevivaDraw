import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { bindTextToContainer, getOrCreateBoundText } from "../text/bound-text";
import { bindArrowEndpoint } from "../bindings/binding-model";
import { DEFAULT_BINDING_GAP } from "../bindings/binding-model";
import { duplicateElements, insertElements, InternalClipboard } from "./clipboard";
import { expandToGroupMembers, groupSelection } from "./group-ungroup";

describe("duplicateElements", () => {
  it("creates new elements with new ids, offset from the originals, keeping the same seed", () => {
    const scene = new Scene();
    const original = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));

    const [newId] = duplicateElements(scene, [original.id], { dx: 5, dy: 7 });
    const duplicate = scene.getElement(newId!)!;

    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.x).toBe(5);
    expect(duplicate.y).toBe(7);
    expect(duplicate.seed).toBe(original.seed); // identical look, per spec
    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(2);
  });

  it("duplicating a container also duplicates its bound text, correctly rebound to the new container", () => {
    const scene = new Scene();
    const container = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const text = scene.addElement(createTextElement({ x: 10, y: 10, width: 80, height: 20, text: "hi", containerId: container.id }));
    bindTextToContainer(scene, container.id, text.id);

    const newIds = duplicateElements(scene, [container.id]); // only the container explicitly selected
    expect(newIds).toHaveLength(2); // container + its bound text traveled along

    const newContainer = scene.getElement(newIds.find((id) => scene.getElement(id)?.type === "rectangle")!)!;
    const newText = scene.getElement(newIds.find((id) => scene.getElement(id)?.type === "text")!)!;
    expect((newText as { containerId: string | null }).containerId).toBe(newContainer.id);
    expect(newContainer.boundElements).toEqual([{ id: newText.id, type: "text" }]);
  });

  it("an arrow bound to a shape that was NOT duplicated in the same batch loses that binding (no dangling ref)", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: DEFAULT_BINDING_GAP });

    const [newArrowId] = duplicateElements(scene, [arrow.id]); // shape not included
    const newArrow = scene.getElement(newArrowId!) as ReturnType<typeof createArrowElement>;
    expect(newArrow.startBinding).toBeNull();
    // The original shape must not gain a stray back-ref to the new arrow either.
    expect(scene.getElement(shape.id)?.boundElements?.some((ref) => ref.id === newArrowId)).toBeFalsy();
  });

  it("an arrow bound to a shape duplicated in the SAME batch keeps the binding, remapped to the new shape", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: DEFAULT_BINDING_GAP });

    const newIds = duplicateElements(scene, [arrow.id, shape.id]);
    const newShapeId = newIds.find((id) => scene.getElement(id)?.type === "rectangle")!;
    const newArrowId = newIds.find((id) => scene.getElement(id)?.type === "arrow")!;
    const newArrow = scene.getElement(newArrowId) as ReturnType<typeof createArrowElement>;
    expect(newArrow.startBinding?.elementId).toBe(newShapeId);
  });

  it("gives the copy its own group ids, so clicking it does not also select the original", () => {
    const scene = new Scene();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const b = scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10 }));
    const groupId = groupSelection(scene, [a.id, b.id])!;

    const newIds = duplicateElements(scene, [a.id, b.id]);
    const copyGroupId = scene.getElement(newIds[0]!)!.groupIds[0]!;

    expect(copyGroupId).not.toBe(groupId);
    // `expandToGroupMembers` resolves a group by scanning the whole scene for a shared outermost
    // group id, so a shared id would make one click select all four elements.
    expect(expandToGroupMembers(scene, [newIds[0]!])).toHaveLength(2);
    expect(expandToGroupMembers(scene, [a.id])).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("keeps group nesting intact while re-minting each level", () => {
    const scene = new Scene();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const b = scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10 }));
    groupSelection(scene, [a.id, b.id]);
    groupSelection(scene, [a.id, b.id]); // nest it one level deeper
    const sourceGroups = scene.getElement(a.id)!.groupIds;

    const newIds = duplicateElements(scene, [a.id, b.id]);
    const [firstGroups, secondGroups] = newIds.map((id) => scene.getElement(id)!.groupIds);

    expect(firstGroups).toHaveLength(2);
    expect(firstGroups).not.toEqual(sourceGroups); // every level re-minted, not just the outermost
    expect(firstGroups).toEqual(secondGroups); // both members still share both levels
    expect(new Set(firstGroups).size).toBe(2); // ...and the two levels stayed distinct
  });
});

describe("InternalClipboard", () => {
  it("copy then paste inserts fresh copies offset from the snapshot", () => {
    const scene = new Scene();
    const original = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const clipboard = new InternalClipboard();

    clipboard.copy(scene, [original.id]);
    scene.deleteElement(original.id); // paste must not depend on the original still existing

    const [pastedId] = clipboard.paste(scene, { dx: 20, dy: 20 });
    const pasted = scene.getElement(pastedId!)!;
    expect(pasted.x).toBe(20);
    expect(pasted.y).toBe(20);
  });

  it("hasContent reflects whether anything has been copied", () => {
    const clipboard = new InternalClipboard();
    expect(clipboard.hasContent()).toBe(false);
    const scene = new Scene();
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    clipboard.copy(scene, [el.id]);
    expect(clipboard.hasContent()).toBe(true);
  });

  it("pasting with no prior copy is a no-op", () => {
    const scene = new Scene();
    const clipboard = new InternalClipboard();
    expect(clipboard.paste(scene)).toEqual([]);
    expect(scene.getElements()).toHaveLength(0);
  });

  it("pasting twice inserts two independent copies", () => {
    const scene = new Scene();
    const original = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const clipboard = new InternalClipboard();
    clipboard.copy(scene, [original.id]);

    const [firstId] = clipboard.paste(scene);
    const [secondId] = clipboard.paste(scene);
    expect(firstId).not.toBe(secondId);
    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(3);
  });
});

describe("insertElements", () => {
  it("inserts external elements as fresh copies (new ids), offset, remapping bound text", () => {
    const source = new Scene();
    const rect = source.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const { textElementId } = getOrCreateBoundText(source, rect.id);
    const saved = source.getElements().filter((el) => !el.isDeleted).map((el) => ({ ...el }));

    const target = new Scene();
    const newIds = insertElements(target, saved, { dx: 100, dy: 100 });

    expect(newIds).toHaveLength(2);
    expect(newIds).not.toContain(rect.id);
    expect(newIds).not.toContain(textElementId);
    const container = target.getElement(newIds[0]!)!;
    expect(container.x).toBe(100); // offset applied
    // The bound-text ref was remapped to the newly-inserted text, not the original id.
    const boundRef = container.boundElements?.find((r) => r.type === "text");
    expect(newIds).toContain(boundRef!.id);
  });

  it("dropping the same grouped library item twice produces two independent groups", () => {
    // The library hands the *same* stored elements to every insert, so without a group-id re-mint
    // the second drop would join the first one's group and the two copies could never be moved apart.
    const item = [
      createRectangleElement({ x: 0, y: 0, width: 10, height: 10, groupIds: ["saved-group"] }),
      createRectangleElement({ x: 20, y: 0, width: 10, height: 10, groupIds: ["saved-group"] }),
    ];
    const scene = new Scene();
    const first = insertElements(scene, item);
    const second = insertElements(scene, item, { dx: 200, dy: 200 });

    expect(expandToGroupMembers(scene, [first[0]!]).sort()).toEqual([...first].sort());
    expect(expandToGroupMembers(scene, [second[0]!]).sort()).toEqual([...second].sort());
  });
});
