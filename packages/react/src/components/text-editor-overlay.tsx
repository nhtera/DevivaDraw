/**
 * The real `<textarea>` WYSIWYG overlay — the first genuine DOM component in this package (native
 * text input/IME/spellcheck instead of hand-rolled canvas text editing, per the engine's
 * `text-edit-session.ts` module doc). Absolutely positioned over the canvas via
 * `use-text-editing.ts`'s derived geometry; swapped back for the canvas-rendered text on
 * blur/Escape/Enter, all handled by that hook — this component only wires the DOM events to it.
 * The composed `<DevivaDraw/>` app shell passes `subscribeCamera` (a `runtime/camera-store.ts`
 * subscription) so this overlay's position tracks a live pan/zoom instead of drifting stale mid-edit,
 * and passes the active theme's `canvasBackground` token as `canvasBackgroundColor` so the overlay's
 * opaque backing matches the canvas in both light and dark mode.
 *
 * Not unit tested: `HTMLTextAreaElement`/focus/`scrollHeight` behavior don't exist in this
 * package's node-based vitest environment (no `jsdom` dependency, same trade-off
 * `@deviva-draw/engine`'s `render/canvas-stage.ts` documents for its own DOM-only surface).
 * Verified manually via `apps/web`'s app shell instead.
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
  // so typing replaces it outright). Deferred to the next animation frame rather than focused
  // synchronously in this effect: the click/tap that places a new text element is still an
  // in-flight pointer gesture when this component first commits (`tools/text-tool.ts` creates the
  // element and opens the session on `pointerdown`, before the matching `pointerup` has fired) — the
  // engine's `PointerEventPipeline` holds `setPointerCapture` on the canvas for that entire gesture,
  // and focusing this textarea *before* the gesture's `pointerup`/`mouseup`/`click` cascade finishes
  // gets immediately reverted (the browser blurs it back once those events resolve against the
  // still-capturing, non-focusable canvas) — the exact "focus, then an instant unexplained blur"
  // race this defer avoids by waiting until the gesture has fully settled.
  //
  // Deliberately `requestAnimationFrame`, not an explicit "gesture ended" signal, even though
  // `tools/text-tool.ts` now exposes exactly that via `onGestureEnd` (added for the same underlying
  // race — see that method's doc): `rAF` is a *reliable* ordering guarantee here, not a guess — a
  // browser always finishes dispatching the current gesture's `pointerup`/`mouseup`/`click` (all
  // synchronous DOM events) before the next animation frame runs, so by the time this callback fires
  // the capture-driven blur has already happened and this focus() is the one that sticks. Piping
  // `onGestureEnd` through to this component instead would need either (a) `TextEditSession` learning
  // about pointer-gesture lifecycle — a real abstraction leak, since `startBoundTextEdit`/
  // `startArrowLabelEdit` (double-click-to-edit) open the *same* session type from a plain native
  // `dblclick` listener with no pointer gesture in flight at all, where waiting for "the next
  // pointerup" would wrongly delay focus until some unrelated future click — or (b) a parallel
  // "was this session opened mid-gesture" flag threaded through every session-start call site. Both
  // are disproportionate to the one-frame delay this comment documents instead.
  //
  // Not unit tested (see this file's own module doc); this ordering guarantee is the browser's own
  // event-loop contract, not app logic this package owns to assert against.
  useEffect(() => {
    if (!overlay) return;
    const frame = requestAnimationFrame(() => {
      const node = textareaRef.current;
      node?.focus();
      node?.select();
    });
    return () => cancelAnimationFrame(frame);
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
