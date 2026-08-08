/**
 * Key-combo -> action-name registry with registration-time conflict detection (`register()` warns
 * immediately if a combo is already bound to a different action). This phase registers only its own
 * features (tool-switch + pan/zoom); the full shortcut map is populated once the concrete tools,
 * menus, and remaining actions exist (a later phase) — `register()` stays a public method so that
 * phase can keep adding to the same registry instance instead of replacing it.
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

/** No-modifier tool-switch keys and the pan/zoom shortcuts this phase owns. */
export function registerCoreShortcuts(registry: ShortcutRegistry): void {
  registry.register("1", "select-tool");
  registry.register("h", "pan-tool");
  registry.register("shift+1", "zoom-to-fit");
  for (const modifier of ["ctrl", "meta"]) {
    registry.register(`${modifier}+=`, "zoom-in");
    registry.register(`${modifier}++`, "zoom-in"); // some layouts report "+" directly as `key`
    registry.register(`${modifier}+-`, "zoom-out");
  }
}
