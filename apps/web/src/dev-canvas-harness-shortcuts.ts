/**
 * Tool-switch keyboard shortcuts for the dev harness, layered on top of `registerCoreShortcuts`'s
 * own pan/zoom + `1`-for-select bindings. Split out of `dev-canvas-harness-runtime.ts` purely to
 * keep that file under the house line-count limit.
 */
import { registerCoreShortcuts, ShortcutRegistry } from "@deviva-draw/engine";

/**
 * Matches Excalidraw's letter conventions (muscle memory, not a trademark concern — shortcuts
 * aren't copyrightable): R/O/D/L for rectangle/ellipse("oval")/diamond/line, P for the pencil, T for
 * text, A for arrow. `V` is the second common binding for the select tool alongside `1`.
 */
export function createDevHarnessShortcutRegistry(): ShortcutRegistry {
  const registry = new ShortcutRegistry();
  registerCoreShortcuts(registry);
  registry.register("v", "select-tool");
  registry.register("r", "rectangle-tool");
  registry.register("o", "ellipse-tool");
  registry.register("d", "diamond-tool");
  registry.register("l", "line-tool");
  registry.register("p", "freedraw-tool");
  registry.register("t", "text-tool");
  registry.register("a", "arrow-tool");
  return registry;
}
