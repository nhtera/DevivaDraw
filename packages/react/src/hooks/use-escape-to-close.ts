/**
 * Escape closes the overlay that is open — the one dismissal every modal surface is expected to have,
 * kept in one place so no new dialog can quietly ship without it.
 *
 * The dialogs each grew their own dismissals independently (an overlay click, a header ×) and only the
 * shortcuts dialog ever handled the key, so Escape worked on one of six: export, share, collaborate,
 * embed and mermaid all sat there until the user found the mouse. A window listener is what makes this
 * work wherever focus happens to be — a dialog that autofocuses an input (embed, share) never has focus
 * on the dialog element itself, so an element-level `onKeyDown` would miss the key entirely.
 *
 * The canvas's own Escape (deselect/cancel) does not double-fire underneath: the shell suppresses the
 * global shortcut resolver while a chrome overlay is open (`shouldSuppressGlobalShortcuts`). A listener
 * inside the dialog that stops propagation before the key reaches `window` — the shortcuts dialog's
 * search input does, so a letter typed there can never leak to a global binding — keeps its own Escape
 * handling, since this hook cannot see a key that never arrives.
 */
import { useEffect } from "react";

/** Calls `onClose` on Escape for as long as the component is mounted. */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}
