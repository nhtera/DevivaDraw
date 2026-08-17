import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUT_DEVICE_PREFERENCE,
  INPUT_DEVICE_STORAGE_KEY,
  parseInputDevicePreference,
  readStoredInputDevicePreference,
  writeStoredInputDevicePreference,
} from "./input-device-preference";
import type { StorageLike } from "../theme/theme-storage";

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

describe("parseInputDevicePreference", () => {
  it("returns the default when nothing was stored", () => {
    expect(parseInputDevicePreference(null)).toEqual(DEFAULT_INPUT_DEVICE_PREFERENCE);
  });

  it("round-trips a valid stored value", () => {
    expect(parseInputDevicePreference(JSON.stringify({ mode: "mouse", invertMouseZoom: true, penOnlyDraw: true }))).toEqual({ mode: "mouse", invertMouseZoom: true, penOnlyDraw: true });
  });

  it("upgrades a value stored before penOnlyDraw existed (field defaults to false)", () => {
    expect(parseInputDevicePreference(JSON.stringify({ mode: "mouse", invertMouseZoom: true }))).toEqual({ mode: "mouse", invertMouseZoom: true, penOnlyDraw: false });
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["truncated value", '{"mode":"mo'],
    ["non-object JSON", '"mouse"'],
    ["null JSON", "null"],
  ])("falls back to the default on %s without throwing", (_label, raw) => {
    expect(parseInputDevicePreference(raw)).toEqual(DEFAULT_INPUT_DEVICE_PREFERENCE);
  });

  it("recovers wrong-type fields individually, keeping the valid ones", () => {
    expect(parseInputDevicePreference(JSON.stringify({ mode: "sideways", invertMouseZoom: true }))).toEqual({ mode: "auto", invertMouseZoom: true, penOnlyDraw: false });
    expect(parseInputDevicePreference(JSON.stringify({ mode: "trackpad", invertMouseZoom: "yes", penOnlyDraw: 1 }))).toEqual({ mode: "trackpad", invertMouseZoom: false, penOnlyDraw: false });
  });

  it("ignores unknown extra fields (forward compatibility with later versions)", () => {
    expect(parseInputDevicePreference(JSON.stringify({ mode: "mouse", invertMouseZoom: false, penOnlyDraw: false, futureFlag: 7 }))).toEqual({ mode: "mouse", invertMouseZoom: false, penOnlyDraw: false });
  });
});

describe("stored read/write", () => {
  it("persists under the versioned key and reads back", () => {
    const storage = fakeStorage();
    writeStoredInputDevicePreference(storage, { mode: "trackpad", invertMouseZoom: true, penOnlyDraw: true });
    expect(Object.keys(storage.values)).toEqual([INPUT_DEVICE_STORAGE_KEY]);
    expect(readStoredInputDevicePreference(storage)).toEqual({ mode: "trackpad", invertMouseZoom: true, penOnlyDraw: true });
  });

  it("does not throw when storage rejects the write (quota)", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeStoredInputDevicePreference(storage, DEFAULT_INPUT_DEVICE_PREFERENCE)).not.toThrow();
  });
});
