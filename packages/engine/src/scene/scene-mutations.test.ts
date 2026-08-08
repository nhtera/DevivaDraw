import { describe, expect, it, vi } from "vitest";
import { createGenericElement } from "../elements/element-types";
import { randomVersionNonce, touch } from "./scene-mutations";

describe("touch", () => {
  it("bumps version by exactly one", () => {
    const element = { ...createGenericElement({ x: 0, y: 0 }), version: 5 };
    const touched = touch(element);
    expect(touched.version).toBe(6);
  });

  it("regenerates versionNonce even when no changes are passed", () => {
    const element = { ...createGenericElement({ x: 0, y: 0 }), versionNonce: 111 };
    const touched = touch(element);
    expect(touched.versionNonce).not.toBe(111);
  });

  it("updates the `updated` timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const element = createGenericElement({ x: 0, y: 0 });
    const touched = touch(element);
    expect(touched.updated).toBe(1000);
    vi.useRealTimers();
  });

  it("applies field changes alongside the version bump", () => {
    const element = createGenericElement({ x: 0, y: 0 });
    const touched = touch(element, { x: 99, backgroundColor: "#ff0000" });
    expect(touched.x).toBe(99);
    expect(touched.backgroundColor).toBe("#ff0000");
  });

  it("returns a new object rather than mutating the input", () => {
    const element = createGenericElement({ x: 0, y: 0 });
    const touched = touch(element, { x: 42 });
    expect(element.x).toBe(0);
    expect(touched).not.toBe(element);
  });

  it("never lets a caller override version/versionNonce/updated through changes", () => {
    // `changes` is typed as Partial<T>, so this exercises the runtime guarantee that the
    // touch-owned fields listed after the spread always win regardless of call-site intent.
    const element = { ...createGenericElement({ x: 0, y: 0 }), version: 3 };
    const touched = touch(element, { version: 999, versionNonce: 999, updated: 999 } as Partial<typeof element>);
    expect(touched.version).toBe(4);
    expect(touched.versionNonce).not.toBe(999);
  });
});

describe("randomVersionNonce", () => {
  it("returns a non-negative integer", () => {
    const nonce = randomVersionNonce();
    expect(Number.isInteger(nonce)).toBe(true);
    expect(nonce).toBeGreaterThanOrEqual(0);
  });

  it("is not constant across calls", () => {
    const values = new Set(Array.from({ length: 20 }, () => randomVersionNonce()));
    expect(values.size).toBeGreaterThan(1);
  });
});
