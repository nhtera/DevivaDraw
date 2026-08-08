/**
 * The real `<textarea>` WYSIWYG overlay — the first genuine DOM component in this package (native
 * text input/IME/spellcheck instead of hand-rolled canvas text editing, per the engine's
 * `text-edit-session.ts` module doc). Absolutely positioned over the canvas via
 * `use-text-editing.ts`'s derived geometry; swapped back for the canvas-rendered text on
 * blur/Escape/Enter, all handled by that hook — this component only wires the DOM events to it.
 *
 * Not unit tested: `HTMLTextAreaElement`/focus/`scrollHeight` behavior don't exist in this
 * package's node-based vitest environment (no `jsdom` dependency, same trade-off
 * `@deviva-draw/engine`'s `render/canvas-stage.ts` documents for its own DOM-only surface).
 * Verified manually via the dev harness in `apps/web` instead.
 */
import { useEffect, useRef } from "react";
import type { UseTextEditingOptions } from "../hooks/use-text-editing";
import { useTextEditing } from "../hooks/use-text-editing";

export type TextEditorOverlayProps = UseTextEditingOptions;

export function TextEditorOverlay(props: TextEditorOverlayProps) {
  const overlay = useTextEditing(props);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus + select-all the moment a new element starts editing (matches every text tool in this
  // genre: click-to-place lands you straight in typing, double-click-to-edit selects existing text
  // so typing replaces it outright).
  useEffect(() => {
    if (!overlay) return;
    const node = textareaRef.current;
    node?.focus();
    node?.select();
  }, [overlay?.elementId]);

  // Auto-grows the textarea's height to fit its content as the user types — the standard
  // reset-then-measure-scrollHeight technique; CSS alone can't do this for a `<textarea>`.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node || !overlay) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [overlay?.value, overlay?.elementId]);

  if (!overlay) return null;

  return (
    <div style={overlay.containerStyle} data-testid="text-editor-overlay">
      <textarea
        ref={textareaRef}
        data-testid="text-editor-overlay-textarea"
        value={overlay.value}
        style={overlay.textareaStyle}
        spellCheck={false}
        onChange={(event) => overlay.onChange(event.target.value)}
        onBlur={overlay.onBlur}
        onKeyDown={overlay.onKeyDown}
      />
    </div>
  );
}
