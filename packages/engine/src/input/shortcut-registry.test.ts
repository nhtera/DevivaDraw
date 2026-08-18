import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeCombo,
  registerChromeToggleShortcuts,
  registerCommandPaletteShortcut,
  registerCoreShortcuts,
  registerFullShortcutMap,
  registerHistoryShortcuts,
  registerToolShortcuts,
  ShortcutRegistry,
} from "./shortcut-registry";

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

    // Digit tool shortcuts mirror Excalidraw's numbering exactly.
    expect(registry.resolve("2", NO_MODIFIERS)).toBe("rectangle-tool");
    expect(registry.resolve("3", NO_MODIFIERS)).toBe("diamond-tool");
    expect(registry.resolve("4", NO_MODIFIERS)).toBe("ellipse-tool");
    expect(registry.resolve("5", NO_MODIFIERS)).toBe("arrow-tool");
    expect(registry.resolve("6", NO_MODIFIERS)).toBe("line-tool");
    expect(registry.resolve("7", NO_MODIFIERS)).toBe("freedraw-tool");
    expect(registry.resolve("8", NO_MODIFIERS)).toBe("text-tool");
    expect(registry.resolve("0", NO_MODIFIERS)).toBe("eraser-tool");
  });
});

describe("registerToolShortcuts", () => {
  it("registers the letter shortcut for every non-select/pan tool, with no internal conflicts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ShortcutRegistry();
    registerToolShortcuts(registry);

    expect(warn).not.toHaveBeenCalled();
    expect(registry.resolve("v", NO_MODIFIERS)).toBe("select-tool");
    expect(registry.resolve("r", NO_MODIFIERS)).toBe("rectangle-tool");
    expect(registry.resolve("o", NO_MODIFIERS)).toBe("ellipse-tool");
    expect(registry.resolve("d", NO_MODIFIERS)).toBe("diamond-tool");
    expect(registry.resolve("l", NO_MODIFIERS)).toBe("line-tool");
    expect(registry.resolve("p", NO_MODIFIERS)).toBe("freedraw-tool");
    expect(registry.resolve("t", NO_MODIFIERS)).toBe("text-tool");
    expect(registry.resolve("a", NO_MODIFIERS)).toBe("arrow-tool");
    expect(registry.resolve("e", NO_MODIFIERS)).toBe("eraser-tool");
    expect(registry.resolve("k", NO_MODIFIERS)).toBe("laser-tool");
  });
});

describe("registerHistoryShortcuts", () => {
  it("registers Ctrl/Cmd+Z for undo and Ctrl/Cmd+Shift+Z for redo", () => {
    const registry = new ShortcutRegistry();
    registerHistoryShortcuts(registry);

    expect(registry.resolve("z", { ...NO_MODIFIERS, ctrl: true })).toBe("undo");
    expect(registry.resolve("z", { ...NO_MODIFIERS, meta: true })).toBe("undo");
    expect(registry.resolve("z", { ...NO_MODIFIERS, ctrl: true, shift: true })).toBe("redo");
    expect(registry.resolve("z", { ...NO_MODIFIERS, meta: true, shift: true })).toBe("redo");
  });
});

describe("registerCommandPaletteShortcut", () => {
  it("registers Ctrl/Cmd+K to open the command palette", () => {
    const registry = new ShortcutRegistry();
    registerCommandPaletteShortcut(registry);

    expect(registry.resolve("k", { ...NO_MODIFIERS, ctrl: true })).toBe("open-command-palette");
    expect(registry.resolve("k", { ...NO_MODIFIERS, meta: true })).toBe("open-command-palette");
  });
});

describe("registerChromeToggleShortcuts", () => {
  it("registers the four chrome toggles with no internal conflicts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ShortcutRegistry();
    registerChromeToggleShortcuts(registry);

    expect(warn).not.toHaveBeenCalled();
    expect(registry.resolve("z", { ...NO_MODIFIERS, alt: true })).toBe("toggle-zen-mode");
    expect(registry.resolve("r", { ...NO_MODIFIERS, alt: true })).toBe("toggle-view-only");
    expect(registry.resolve("/", { ...NO_MODIFIERS, alt: true })).toBe("toggle-properties-panel");
    expect(registry.resolve("q", NO_MODIFIERS)).toBe("toggle-tool-lock");
  });

  it("also resolves the character some layouts compose for Alt+slash", () => {
    const registry = new ShortcutRegistry();
    registerChromeToggleShortcuts(registry);

    expect(registry.resolve("÷", { ...NO_MODIFIERS, alt: true })).toBe("toggle-properties-panel");
  });

  it("leaves the un-modified letters the tool shortcuts own untouched", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ShortcutRegistry();
    registerToolShortcuts(registry);
    registerChromeToggleShortcuts(registry);

    // `q` is the only bare letter this function claims — a future tool letter colliding with it
    // would warn here rather than silently losing one of the two bindings.
    expect(warn).not.toHaveBeenCalled();
    expect(registry.resolve("z", NO_MODIFIERS)).toBeUndefined();
    expect(registry.resolve("r", NO_MODIFIERS)).toBe("rectangle-tool");
  });
});

describe("registerFullShortcutMap", () => {
  it("composes every registration function with zero internal conflicts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ShortcutRegistry();
    registerFullShortcutMap(registry);

    expect(warn).not.toHaveBeenCalled();
    // Spot-check one binding from each composed function.
    expect(registry.resolve("1", NO_MODIFIERS)).toBe("select-tool");
    expect(registry.resolve("r", NO_MODIFIERS)).toBe("rectangle-tool");
    expect(registry.resolve("z", { ...NO_MODIFIERS, meta: true })).toBe("undo");
    expect(registry.resolve("k", { ...NO_MODIFIERS, meta: true })).toBe("open-command-palette");
    expect(registry.resolve("b", NO_MODIFIERS)).toBe("bucket-fill-tool");
    expect(registry.resolve("c", { ...NO_MODIFIERS, meta: true, alt: true })).toBe("copy-styles");
    expect(registry.resolve("v", { ...NO_MODIFIERS, ctrl: true, alt: true })).toBe("paste-styles");
    expect(registry.resolve("x", { ...NO_MODIFIERS, shift: true })).toBe("draw-to-shape");
    expect(registry.resolve("s", { ...NO_MODIFIERS, alt: true })).toBe("toggle-object-snap");
    expect(registry.resolve("'", { ...NO_MODIFIERS, meta: true })).toBe("toggle-grid");
    expect(registry.resolve("'", { ...NO_MODIFIERS, ctrl: true })).toBe("toggle-grid");
    expect(registry.resolve(">", { ...NO_MODIFIERS, meta: true, shift: true })).toBe("increase-font-size");
    expect(registry.resolve("<", { ...NO_MODIFIERS, ctrl: true, shift: true })).toBe("decrease-font-size");
    expect(registry.resolve("z", { ...NO_MODIFIERS, alt: true })).toBe("toggle-zen-mode");
    expect(registry.resolve("q", NO_MODIFIERS)).toBe("toggle-tool-lock");
    expect(registry.resolve("c", NO_MODIFIERS)).toBe("comment-tool");
    expect(registry.resolve("c", { ...NO_MODIFIERS, alt: true })).toBe("toggle-comments");
  });

  /**
   * The composed-character bindings. On a Mac layout Option+the-base-key composes a different
   * character, and the browser reports THAT in `event.key` — so a binding registered only under its
   * base key silently never fires there while the menu still advertises the shortcut. Each such
   * binding must resolve under both forms; this test is what keeps a new one from forgetting.
   */
  it("resolves the Option-composed form of every alt binding that composes on a Mac layout", () => {
    const registry = new ShortcutRegistry();
    registerFullShortcutMap(registry);

    expect(registry.resolve("÷", { ...NO_MODIFIERS, alt: true })).toBe("toggle-properties-panel");
    expect(registry.resolve("ç", { ...NO_MODIFIERS, alt: true })).toBe("toggle-comments");
  });
});
