/**
 * Key-combo -> action-name registry with registration-time conflict detection (`register()` warns
 * immediately if a combo is already bound to a different action). `registerCoreShortcuts` covers this
 * package's own tool-switch/pan-zoom bindings; `registerToolShortcuts`/`registerHistoryShortcuts`/
 * `registerCommandPaletteShortcut` add the remaining letter/tool/undo-redo/palette bindings the UI
 * chrome layer (`@deviva-draw/react`) wires up — `registerFullShortcutMap` composes all of them into
 * the one registry instance a host app's pointer pipeline resolves every keydown against. Note: some
 * "shortcuts" mentioned by the product spec (Delete, Escape, arrow-key nudge, Ctrl/Cmd+A/C/V/D/G/L,
 * `[`/`]`) are deliberately *not* registered here — they're handled inside the select tool's own
 * `onKeyDown` fallback (`selection/selection-tool-keyboard.ts`), which every unmatched key reaches
 * (see `input/wheel-keyboard-controller.ts`'s resolution precedence) — registering them here would
 * intercept them before they ever reach that handler.
 */
import type { ModifierKeys } from "./tool-handler";

/** Canonical combo string: modifier order is fixed so equivalent combos always normalize identically. */
export function normalizeCombo(key: string, modifiers: ModifierKeys): string {
  const parts: string[] = [];
  if (modifiers.ctrl) parts.push("ctrl");
  if (modifiers.meta) parts.push("meta");
  if (modifiers.alt) parts.push("alt");
  if (modifiers.shift) parts.push("shift");
  parts.push(key.length === 1 ? key.toLowerCase() : key);
  return parts.join("+");
}

export class ShortcutRegistry {
  private readonly bindings = new Map<string, string>();

  /**
   * Registers `combo` (already-normalized form, e.g. `"ctrl+="`, `"shift+1"`, `"h"`) to fire
   * `action`. A combo re-registered to a *different* action is a conflict: warns via `console.warn`
   * and keeps the first binding rather than throwing, so the caller populating a large shortcut map
   * sees every conflict in one pass instead of stopping at the first. Re-registering the same combo
   * with the *same* action is not a conflict (harmless idempotent re-registration).
   */
  register(combo: string, action: string): void {
    const normalized = combo.toLowerCase();
    const existing = this.bindings.get(normalized);
    if (existing && existing !== action) {
      console.warn(`shortcut-registry: "${normalized}" already bound to "${existing}"; ignoring "${action}"`);
      return;
    }
    this.bindings.set(normalized, action);
  }

  /** Resolves a raw key event to its bound action name, or `undefined` if nothing is bound to it. */
  resolve(key: string, modifiers: ModifierKeys): string | undefined {
    return this.bindings.get(normalizeCombo(key, modifiers));
  }

  has(combo: string): boolean {
    return this.bindings.has(combo.toLowerCase());
  }
}

/** No-modifier tool-switch keys and the pan/zoom shortcuts registered here. */
export function registerCoreShortcuts(registry: ShortcutRegistry): void {
  registry.register("1", "select-tool");
  registry.register("h", "pan-tool");
  // Digit tool shortcuts, matching Excalidraw's numbering exactly so the muscle memory carries over
  // (1 select is above; letters are the second binding for each, see `registerToolShortcuts`).
  registry.register("2", "rectangle-tool");
  registry.register("3", "diamond-tool");
  registry.register("4", "ellipse-tool");
  registry.register("5", "arrow-tool");
  registry.register("6", "line-tool");
  registry.register("7", "freedraw-tool");
  registry.register("8", "text-tool");
  registry.register("0", "eraser-tool");
  registry.register("shift+1", "zoom-to-fit");
  for (const modifier of ["ctrl", "meta"]) {
    registry.register(`${modifier}+=`, "zoom-in");
    registry.register(`${modifier}++`, "zoom-in"); // some layouts report "+" directly as `key`
    registry.register(`${modifier}+-`, "zoom-out");
  }
}

/**
 * No-modifier letter shortcuts for every remaining tool, matching this genre's conventional
 * mnemonics: R/O/D/L for rectangle/ellipse("oval")/diamond/line, P for the pencil (freehand), T for
 * text, A for arrow, E for eraser. `V` is the second common binding for the select tool alongside
 * `registerCoreShortcuts`'s `1`.
 */
export function registerToolShortcuts(registry: ShortcutRegistry): void {
  registry.register("v", "select-tool");
  registry.register("r", "rectangle-tool");
  registry.register("o", "ellipse-tool");
  registry.register("d", "diamond-tool");
  registry.register("l", "line-tool");
  registry.register("p", "freedraw-tool");
  registry.register("t", "text-tool");
  registry.register("a", "arrow-tool");
  registry.register("e", "eraser-tool");
  registry.register("k", "laser-tool");
  registry.register("f", "frame-tool");
  registry.register("n", "note-tool");
  registry.register("b", "bucket-fill-tool");
}

/**
 * Copy/paste *styles* (as opposed to whole elements) — `Ctrl/Cmd+Alt+C` / `Ctrl/Cmd+Alt+V`, matching
 * Excalidraw. The Alt distinguishes them from the plain `Ctrl/Cmd+C`/`V` element copy/paste that the
 * select tool's own `onKeyDown` owns; these carry a modifier that tool doesn't handle, so registering
 * them here routes them to the `copy-styles`/`paste-styles` actions instead.
 */
export function registerStyleClipboardShortcuts(registry: ShortcutRegistry): void {
  for (const modifier of ["ctrl", "meta"]) {
    registry.register(`${modifier}+alt+c`, "copy-styles");
    registry.register(`${modifier}+alt+v`, "paste-styles");
  }
  // "Draw to shape" — cleans a selected freehand stroke into a recognized shape (Excalidraw's Shift+X).
  registry.register("shift+x", "draw-to-shape");
}

/**
 * Canvas preferences that have no tool of their own — `Alt+S` toggles align-to-other-elements
 * snapping, and `Ctrl/Cmd+'` toggles the dot grid, the combos mainstream whiteboards use for the
 * same preferences.
 */
export function registerPreferenceShortcuts(registry: ShortcutRegistry): void {
  registry.register("alt+s", "toggle-object-snap");
  registry.register("ctrl+'", "toggle-grid");
  registry.register("meta+'", "toggle-grid");
}

/** Mirroring the selection — `Shift+H` / `Shift+V`, matching Excalidraw. */
export function registerFlipShortcuts(registry: ShortcutRegistry): void {
  registry.register("shift+h", "flip-horizontal");
  registry.register("shift+v", "flip-vertical");
}

/** Undo/redo — `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`, the one shortcut pair no tool's own `onKeyDown` owns (undo/redo is global chrome, not a tool concern). */
export function registerHistoryShortcuts(registry: ShortcutRegistry): void {
  for (const modifier of ["ctrl", "meta"]) {
    registry.register(`${modifier}+z`, "undo");
    registry.register(`${modifier}+shift+z`, "redo");
  }
}

/** `Ctrl/Cmd+K` opens the command palette — the one new chrome-level shortcut beyond undo/redo. */
export function registerCommandPaletteShortcut(registry: ShortcutRegistry): void {
  registry.register("ctrl+k", "open-command-palette");
  registry.register("meta+k", "open-command-palette");
}

/** Composes every registration function above into one registry — the single call a host app's runtime wiring needs. */
export function registerFullShortcutMap(registry: ShortcutRegistry): void {
  registerCoreShortcuts(registry);
  registerToolShortcuts(registry);
  registerPreferenceShortcuts(registry);
  registerHistoryShortcuts(registry);
  registerCommandPaletteShortcut(registry);
  registerStyleClipboardShortcuts(registry);
  registerFlipShortcuts(registry);
}
