import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeCombo, registerCoreShortcuts, ShortcutRegistry } from "./shortcut-registry";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

describe("normalizeCombo", () => {
  it("lowercases single-character keys", () => {
    expect(normalizeCombo("H", NO_MODIFIERS)).toBe("h");
  });

  it("preserves multi-character key names verbatim (e.g. Escape)", () => {
    expect(normalizeCombo("Escape", NO_MODIFIERS)).toBe("Escape");
  });

  it("orders modifiers deterministically regardless of which were pressed", () => {
    expect(normalizeCombo("1", { shift: true, ctrl: true, alt: false, meta: false })).toBe("ctrl+shift+1");
    expect(normalizeCombo("1", { shift: true, ctrl: true, alt: true, meta: true })).toBe("ctrl+meta+alt+shift+1");
  });
});

describe("ShortcutRegistry.register/resolve", () => {
  it("resolves a registered combo back to its action", () => {
    const registry = new ShortcutRegistry();
    registry.register("h", "pan-tool");
    expect(registry.resolve("h", NO_MODIFIERS)).toBe("pan-tool");
    expect(registry.resolve("H", NO_MODIFIERS)).toBe("pan-tool"); // resolve normalizes too
  });

  it("returns undefined for an unbound combo", () => {
    const registry = new ShortcutRegistry();
    expect(registry.resolve("z", NO_MODIFIERS)).toBeUndefined();
  });

  it("has() reflects registration state case-insensitively", () => {
    const registry = new ShortcutRegistry();
    registry.register("Shift+1", "zoom-to-fit");
    expect(registry.has("shift+1")).toBe(true);
    expect(registry.has("ctrl+1")).toBe(false);
  });

  it("re-registering the same combo with the same action is silently idempotent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ShortcutRegistry();
    registry.register("h", "pan-tool");
    registry.register("h", "pan-tool");
    expect(warn).not.toHaveBeenCalled();
    expect(registry.resolve("h", NO_MODIFIERS)).toBe("pan-tool");
  });
});

describe("ShortcutRegistry conflict detection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns (not throws) when a combo is re-registered to a different action, and keeps the first", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ShortcutRegistry();
    registry.register("h", "pan-tool");

    expect(() => registry.register("h", "hide-panel")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(registry.resolve("h", NO_MODIFIERS)).toBe("pan-tool"); // first registration wins
  });
});

describe("registerCoreShortcuts", () => {
  it("registers the tool-switch and pan/zoom shortcuts this phase owns, with no internal conflicts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ShortcutRegistry();
    registerCoreShortcuts(registry);

    expect(warn).not.toHaveBeenCalled();
    expect(registry.resolve("1", NO_MODIFIERS)).toBe("select-tool");
    expect(registry.resolve("h", NO_MODIFIERS)).toBe("pan-tool");
    expect(registry.resolve("1", { ...NO_MODIFIERS, shift: true })).toBe("zoom-to-fit");
    expect(registry.resolve("=", { ...NO_MODIFIERS, ctrl: true })).toBe("zoom-in");
    expect(registry.resolve("=", { ...NO_MODIFIERS, meta: true })).toBe("zoom-in");
    expect(registry.resolve("-", { ...NO_MODIFIERS, ctrl: true })).toBe("zoom-out");
  });
});
