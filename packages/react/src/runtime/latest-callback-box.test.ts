import { describe, expect, it } from "vitest";
import { createLatestCallbackBox } from "./latest-callback-box";

describe("createLatestCallbackBox", () => {
  it("invoke() calls the initial function", () => {
    const box = createLatestCallbackBox(() => "a");
    expect(box.invoke()).toBe("a");
  });

  it("invoke() calls the most recently set function after set()", () => {
    const box = createLatestCallbackBox(() => "a");
    box.set(() => "b");
    expect(box.invoke()).toBe("b");
  });

  it("reflects multiple successive set() calls — always the latest", () => {
    const box = createLatestCallbackBox(() => 1);
    box.set(() => 2);
    box.set(() => 3);
    box.set(() => 4);
    expect(box.invoke()).toBe(4);
  });

  it("forwards arguments through to the current function", () => {
    const box = createLatestCallbackBox((a: number, b: number) => a + b);
    expect(box.invoke(2, 3)).toBe(5);
    box.set((a: number, b: number) => a * b);
    expect(box.invoke(2, 3)).toBe(6);
  });

  it("invoke's identity never changes across set() calls (safe for effect deps / one-time callback wiring)", () => {
    const box = createLatestCallbackBox(() => "a");
    const firstIdentity = box.invoke;
    box.set(() => "b");
    box.set(() => "c");
    expect(box.invoke).toBe(firstIdentity);
  });

  it("a closure captured by an earlier set() call is never invoked again after a later set()", () => {
    const calls: string[] = [];
    const box = createLatestCallbackBox(() => calls.push("first"));
    box.set(() => calls.push("second"));

    box.invoke();

    expect(calls).toEqual(["second"]);
  });
});
