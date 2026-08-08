import { describe, expect, it, vi } from "vitest";
import { SelectionState } from "./selection-state";

describe("SelectionState", () => {
  it("starts empty", () => {
    const state = new SelectionState();
    expect(state.size).toBe(0);
    expect(state.getSelectedIds().size).toBe(0);
  });

  it("selectOnly replaces the whole selection", () => {
    const state = new SelectionState();
    state.selectOnly(["a", "b"]);
    expect([...state.getSelectedIds()].sort()).toEqual(["a", "b"]);
    state.selectOnly(["c"]);
    expect([...state.getSelectedIds()]).toEqual(["c"]);
  });

  it("add unions without clearing existing selection, deduping", () => {
    const state = new SelectionState();
    state.selectOnly(["a"]);
    state.add(["a", "b"]);
    expect([...state.getSelectedIds()].sort()).toEqual(["a", "b"]);
  });

  it("toggle flips membership", () => {
    const state = new SelectionState();
    state.selectOnly(["a"]);
    state.toggle("a");
    expect(state.isSelected("a")).toBe(false);
    state.toggle("a");
    expect(state.isSelected("a")).toBe(true);
  });

  it("remove drops specific ids only", () => {
    const state = new SelectionState();
    state.selectOnly(["a", "b", "c"]);
    state.remove(["b"]);
    expect([...state.getSelectedIds()].sort()).toEqual(["a", "c"]);
  });

  it("clear empties the selection", () => {
    const state = new SelectionState();
    state.selectOnly(["a", "b"]);
    state.clear();
    expect(state.size).toBe(0);
  });

  it("notifies subscribers only on an actual change", () => {
    const state = new SelectionState();
    const listener = vi.fn();
    state.subscribe(listener);

    state.clear(); // already empty: no-op, no notify
    expect(listener).not.toHaveBeenCalled();

    state.selectOnly(["a"]);
    expect(listener).toHaveBeenCalledTimes(1);

    state.add(["a"]); // already present: no-op
    expect(listener).toHaveBeenCalledTimes(1);

    state.toggle("a");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("subscribe returns an unsubscribe function", () => {
    const state = new SelectionState();
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);
    unsubscribe();
    state.selectOnly(["a"]);
    expect(listener).not.toHaveBeenCalled();
  });
});
