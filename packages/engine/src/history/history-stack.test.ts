import { describe, expect, it } from "vitest";
import { createGenericElement } from "../elements/element-types";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { HistoryStack } from "./history-stack";

describe("HistoryStack basic push/undo/redo", () => {
  it("undo restores the previous pushed snapshot", () => {
    const history = new HistoryStack("initial");
    history.push("a");
    history.push("b");

    expect(history.undo()).toBe("a");
    expect(history.undo()).toBe("initial");
  });

  it("undo returns undefined once the start of history is reached", () => {
    const history = new HistoryStack("initial");
    history.push("a");

    expect(history.undo()).toBe("initial");
    expect(history.undo()).toBeUndefined();
  });

  it("redo replays an undone snapshot", () => {
    const history = new HistoryStack("initial");
    history.push("a");
    history.push("b");

    history.undo();
    history.undo();
    expect(history.redo()).toBe("a");
    expect(history.redo()).toBe("b");
  });

  it("redo returns undefined once the end of history is reached", () => {
    const history = new HistoryStack("initial");
    history.push("a");

    expect(history.redo()).toBeUndefined();
  });

  it("canUndo/canRedo reflect cursor position", () => {
    const history = new HistoryStack("initial");
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);

    history.push("a");
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);

    history.undo();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it("a new push after undo clears the redo stack", () => {
    const history = new HistoryStack("initial");
    history.push("a");
    history.push("b");

    history.undo(); // back to "a", "b" is redoable
    expect(history.canRedo()).toBe(true);

    history.push("c"); // fresh edit invalidates the "b" redo branch
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeUndefined();
    expect(history.undo()).toBe("a");
  });
});

describe("HistoryStack gesture batching", () => {
  it("push() calls during an open batch are ignored; only endBatch's snapshot is recorded", () => {
    const history = new HistoryStack(0);
    history.beginBatch();
    // Simulate a drag gesture calling push() on every intermediate frame — none of these should
    // become separate undo steps.
    history.push(1);
    history.push(2);
    history.push(3);
    history.endBatch(4);

    expect(history.undo()).toBe(0); // the single grouped step goes straight back to the pre-gesture state
    expect(history.undo()).toBeUndefined(); // no intermediate 1/2/3 steps exist
  });

  it("groups an entire gesture into exactly one undo step", () => {
    const history = new HistoryStack({ count: 0 });
    history.beginBatch();
    for (let i = 1; i <= 10; i += 1) {
      history.push({ count: i });
    }
    history.endBatch({ count: 10 });

    expect(history.canUndo()).toBe(true);
    const restored = history.undo();
    expect(restored).toEqual({ count: 0 });
    expect(history.canUndo()).toBe(false);
  });

  it("endBatch without a matching beginBatch is a no-op", () => {
    const history = new HistoryStack("initial");
    history.endBatch("ignored");
    expect(history.canUndo()).toBe(false);
  });

  it("a repeated beginBatch before endBatch does not open a nested batch", () => {
    const history = new HistoryStack(0);
    history.beginBatch();
    history.beginBatch(); // no-op; still the same batch
    history.push(1); // suppressed
    history.endBatch(2);

    expect(history.undo()).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it("push() works normally again after a batch closes", () => {
    const history = new HistoryStack(0);
    history.beginBatch();
    history.endBatch(1);
    history.push(2);

    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
  });

  it("isBatchOpen reflects the open/closed state across beginBatch/endBatch", () => {
    const history = new HistoryStack(0);
    expect(history.isBatchOpen()).toBe(false);
    history.beginBatch();
    expect(history.isBatchOpen()).toBe(true);
    history.endBatch(1);
    expect(history.isBatchOpen()).toBe(false);
  });

  it("cancelBatch discards an abandoned gesture without recording anything", () => {
    // e.g. Escape mid-drag or a pointer-cancel event: there is no meaningful "final" snapshot,
    // so the batch must be dropped rather than committed or left open forever.
    const history = new HistoryStack(0);
    history.beginBatch();
    history.push(1); // suppressed while batching, same as any other batch
    history.push(2); // still suppressed
    expect(history.isBatchOpen()).toBe(true);

    history.cancelBatch();

    expect(history.isBatchOpen()).toBe(false);
    expect(history.canUndo()).toBe(false); // nothing from the abandoned batch was recorded
    expect(history.canRedo()).toBe(false);
  });

  it("push() behaves normally again after cancelBatch — the stuck-open bug is fixed", () => {
    const history = new HistoryStack(0);
    history.beginBatch();
    history.push(1); // would be silently dropped forever if batchOpen stayed stuck true
    history.cancelBatch();

    history.push(2);
    history.push(3);

    expect(history.undo()).toBe(2);
    expect(history.undo()).toBe(0);
  });

  it("cancelBatch is a no-op when no batch is currently open", () => {
    const history = new HistoryStack(0);
    history.push(1);
    history.cancelBatch(); // nothing open; must not disturb existing history

    expect(history.isBatchOpen()).toBe(false);
    expect(history.undo()).toBe(0);
  });

  it("beginBatch after a cancelBatch opens a fresh, independent batch", () => {
    const history = new HistoryStack(0);
    history.beginBatch();
    history.push(1); // suppressed
    history.cancelBatch();

    history.beginBatch();
    history.push(2); // suppressed within the new batch
    history.endBatch(3);

    expect(history.undo()).toBe(0);
    expect(history.canUndo()).toBe(false);
  });
});

describe("HistoryStack maxDepth", () => {
  it("caps stack depth, dropping the oldest entries first", () => {
    const history = new HistoryStack(0, { maxDepth: 3 });
    for (let i = 1; i <= 10; i += 1) history.push(i);

    // maxDepth=3 retains 3 snapshots total (current + 2 past), so exactly 2 undo() calls succeed
    // before the oldest retained state (10 pushes in, values 8/9/10 survive) is exhausted.
    expect(history.undo()).toBe(9);
    expect(history.undo()).toBe(8);
    expect(history.undo()).toBeUndefined();
  });

  it("defaults to a depth of 100 when unconfigured", () => {
    const history = new HistoryStack(0);
    for (let i = 1; i <= 150; i += 1) history.push(i);

    let undoCount = 0;
    while (history.undo() !== undefined) undoCount += 1;
    expect(undoCount).toBe(99); // 100 retained states = 99 undo steps back to the oldest kept
  });
});

describe("HistoryStack integration with Scene (scripted sequence)", () => {
  it("add 3 elements, undo twice, redo once produces the exact expected scene snapshot", () => {
    const scene = new Scene();
    const history = new HistoryStack<AnyElement[]>(scene.getElements());

    const a = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    history.push(scene.getElements());
    const b = scene.addElement(createGenericElement({ x: 10, y: 10 }));
    history.push(scene.getElements());
    const c = scene.addElement(createGenericElement({ x: 20, y: 20 }));
    history.push(scene.getElements());

    // After 3 adds: scene has [a, b, c].
    expect(scene.getElements().map((el) => el.id)).toEqual([a.id, b.id, c.id]);

    const afterFirstUndo = history.undo();
    expect(afterFirstUndo?.map((el) => el.id)).toEqual([a.id, b.id]);

    const afterSecondUndo = history.undo();
    expect(afterSecondUndo?.map((el) => el.id)).toEqual([a.id]);

    const afterRedo = history.redo();
    expect(afterRedo?.map((el) => el.id)).toEqual([a.id, b.id]);
    expect(afterRedo).toEqual(afterFirstUndo);
  });
});
