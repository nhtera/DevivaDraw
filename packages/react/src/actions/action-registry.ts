/**
 * The single source of truth every action-triggering surface (toolbar, properties panel, context
 * menu, main menu, command palette, keyboard shortcuts) reads from — one `ActionRegistry` beats four
 * separately-wired paths. Security-relevant by construction: actions are resolved by a fixed `id`
 * string through a `Map` lookup, never by evaluating caller-supplied code, so a context menu/command
 * palette can never execute anything beyond what was explicitly `register()`-ed here.
 */
import type { Action, ActionRuntime } from "./action-types";

export class ActionRegistry {
  private readonly actions = new Map<string, Action>();

  /**
   * Registers `action`. A duplicate `id` is a programmer bug (two action builders picked the same
   * id) — warns via `console.warn` and keeps the first registration, the same "surface every conflict
   * in one pass, never throw" policy `ShortcutRegistry.register` already establishes for the sibling
   * conflict-detection case in `@deviva-draw/engine`.
   */
  register(action: Action): void {
    const existing = this.actions.get(action.id);
    if (existing) {
      console.warn(`action-registry: "${action.id}" is already registered; ignoring the duplicate registration`);
      return;
    }
    this.actions.set(action.id, action);
  }

  get(id: string): Action | undefined {
    return this.actions.get(id);
  }

  /** All registered actions, in registration order — stable for the command palette's default (no-query) listing. */
  list(): Action[] {
    return [...this.actions.values()];
  }

  /** `true` when `id` is registered and its `isEnabled` predicate (if any) passes for `runtime`. */
  isEnabled(id: string, runtime: ActionRuntime): boolean {
    const action = this.actions.get(id);
    if (!action) return false;
    return action.isEnabled ? action.isEnabled(runtime) : true;
  }

  /**
   * Looks up `id` and runs it against `runtime` if found and enabled — the one dispatch path every
   * UI surface calls through (see the module doc's security note). Silently no-ops (via
   * `console.warn`) for an unknown or currently-disabled action id, rather than throwing: a stale
   * keyboard shortcut firing after a selection changed out from under it should never crash the app.
   */
  run(id: string, runtime: ActionRuntime): void | Promise<void> {
    const action = this.actions.get(id);
    if (!action) {
      console.warn(`action-registry: no action registered as "${id}"`);
      return;
    }
    if (action.isEnabled && !action.isEnabled(runtime)) return;
    return action.run(runtime);
  }
}
