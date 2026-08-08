/**
 * Pure combination of every reason the engine's global keyboard-shortcut resolver
 * (`PointerEventPipeline`'s `isEditingTextSuppressed`, forwarded to `WheelKeyboardController` as
 * `isSuppressed`) must stay hands-off for a given keydown. Two independent conditions, both fixed at
 * once here: typing into the live text-edit `<textarea>` overlay (pre-existing), and typing into any
 * chrome overlay's own search input — command palette, shortcuts dialog — or simply having a menu
 * open at all (main menu, context menu), where a bare letter key (e.g. "r") must never leak through
 * to `registerToolShortcuts` and switch tools behind the open overlay. Kept as its own pure function
 * (not inlined into `build-runtime.ts`) so the OR-combination itself is unit-testable without any
 * DOM/engine wiring.
 */
export function shouldSuppressGlobalShortcuts(isEditingText: boolean, isChromeOverlayOpen: boolean): boolean {
  return isEditingText || isChromeOverlayOpen;
}
