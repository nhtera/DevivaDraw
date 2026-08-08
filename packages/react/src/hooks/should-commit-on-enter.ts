/**
 * Pure predicate for "does this Enter keydown commit the text editor" — pulled out of
 * `use-text-editing.ts`'s DOM-bound `onKeyDown` handler so the actual decision logic is testable
 * without a real `<textarea>`/`KeyboardEvent` (this package's vitest environment has no `jsdom`).
 *
 * `isComposing` guards IME composition (Vietnamese diacritic input, CJK input methods): the Enter
 * that confirms a composed candidate must never also commit the editor — without this guard, typing
 * Vietnamese with an IME and pressing Enter to accept a candidate would silently exit editing
 * mid-word instead of finishing the composition.
 */

/** Plain Enter commits/exits; Shift+Enter always inserts a newline (native textarea behavior, left alone by the caller); Enter fired while an IME composition is in progress never commits. */
export function shouldCommitOnEnter(key: string, shiftKey: boolean, isComposing: boolean): boolean {
  return key === "Enter" && !shiftKey && !isComposing;
}
