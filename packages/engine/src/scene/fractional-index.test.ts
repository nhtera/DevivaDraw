import { describe, expect, it } from "vitest";
import {
  indexBetween,
  moveBackward,
  moveForward,
  moveToBack,
  moveToFront,
  type IndexedItem,
} from "./fractional-index";

describe("indexBetween", () => {
  it("sorts strictly between two bounds", () => {
    const key = indexBetween("a0", "a1");
    expect(key > "a0").toBe(true);
    expect(key < "a1").toBe(true);
  });

  it("produces a key after `a` when the upper bound is null", () => {
    const key = indexBetween("a0", null);
    expect(key > "a0").toBe(true);
  });

  it("produces a key before `b` when the lower bound is null", () => {
    const key = indexBetween(null, "a0");
    expect(key < "a0").toBe(true);
  });

  it("stays stable and strictly ordered under 1000 sequential inserts at the same position", () => {
    // Regression test for the class of bug fractional-indexing implementations are prone to:
    // repeatedly inserting between the same two neighbors must keep producing valid, distinct,
    // strictly-ordered keys instead of the index string growing unboundedly or colliding.
    let lower: string | null = "a0";
    const upper: string | null = "a1";
    const generated: string[] = [];

    for (let i = 0; i < 1000; i += 1) {
      const key = indexBetween(lower, upper);
      expect(key > (lower ?? "")).toBe(true);
      expect(key < (upper ?? "￿")).toBe(true);
      generated.push(key);
      lower = key; // next insert goes between the newest key and the same fixed upper bound
    }

    expect(new Set(generated).size).toBe(generated.length);
    // Keys should sort into the exact order they were generated in.
    const sorted = [...generated].sort();
    expect(sorted).toEqual(generated);
    // fractional-indexing's midpoint algorithm grows by roughly one character per insert in the
    // worst case (never converging on a shared length); this bounds the pathological case rather
    // than asserting a specific implementation-dependent length.
    const lastKey = generated.at(-1);
    expect(lastKey).toBeDefined();
    expect(lastKey!.length).toBeLessThan(1100);
  });
});

describe("z-order helpers", () => {
  function items(...pairs: Array<[string, string]>): IndexedItem[] {
    return pairs.map(([id, index]) => ({ id, index }));
  }

  it("moveToFront places the item after the current last index", () => {
    const list = items(["a", "a0"], ["b", "a1"], ["c", "a2"]);
    const newIndex = moveToFront(list, "a");
    expect(newIndex > "a2").toBe(true);
  });

  it("moveToBack places the item before the current first index", () => {
    const list = items(["a", "a0"], ["b", "a1"], ["c", "a2"]);
    const newIndex = moveToBack(list, "c");
    expect(newIndex < "a0").toBe(true);
  });

  it("moveForward swaps the item past its next neighbor", () => {
    const list = items(["a", "a0"], ["b", "a1"], ["c", "a2"]);
    const newIndex = moveForward(list, "a");
    expect(newIndex).toBeDefined();
    // "a" should now sort between "b" (a1) and "c" (a2).
    expect(newIndex! > "a1").toBe(true);
    expect(newIndex! < "a2").toBe(true);
  });

  it("moveForward returns undefined when already frontmost", () => {
    const list = items(["a", "a0"], ["b", "a1"]);
    expect(moveForward(list, "b")).toBeUndefined();
  });

  it("moveForward returns undefined for an unknown id", () => {
    const list = items(["a", "a0"]);
    expect(moveForward(list, "missing")).toBeUndefined();
  });

  it("moveBackward swaps the item before its previous neighbor", () => {
    const list = items(["a", "a0"], ["b", "a1"], ["c", "a2"]);
    const newIndex = moveBackward(list, "c");
    expect(newIndex).toBeDefined();
    // "c" should now sort between "a" (a0) and "b" (a1).
    expect(newIndex! > "a0").toBe(true);
    expect(newIndex! < "a1").toBe(true);
  });

  it("moveBackward returns undefined when already backmost", () => {
    const list = items(["a", "a0"], ["b", "a1"]);
    expect(moveBackward(list, "a")).toBeUndefined();
  });

  it("moveBackward returns undefined for an unknown id", () => {
    const list = items(["a", "a0"]);
    expect(moveBackward(list, "missing")).toBeUndefined();
  });

  it("moveToFront excludes the target's own current index, comparing against the next-highest neighbor", () => {
    const list = items(["a", "a0"], ["b", "a1"], ["c", "a2"]);
    // "b" sits in the middle; excluding it, "c" (a2) is the new highest neighbor to sort after.
    const newIndex = moveToFront(list, "b");
    expect(newIndex > "a2").toBe(true);
  });

  it("moveToFront on the sole item in the list still returns a valid index (no neighbors remain)", () => {
    const list = items(["solo", "a5"]);
    const newIndex = moveToFront(list, "solo");
    expect(typeof newIndex).toBe("string");
    expect(newIndex.length).toBeGreaterThan(0);
  });
});
