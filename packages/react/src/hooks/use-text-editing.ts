/**
 * Derives the overlay geometry/styling + change handlers for whichever `TextElement` a
 * `TextEditSession` currently has open — the bridge between the engine's DOM-free editing state
 * machine (`@deviva-draw/engine`'s `text/text-edit-session.ts`) and the real `<textarea>`
 * `components/text-editor-overlay.tsx` renders. Kept as a hook (not baked into the component)
 * so a host app can build its own overlay UI against the same derived state if it ever needs to.
 */
import { useEffect, useReducer } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { Camera, Scene, TextAlign, TextEditSession } from "@deviva-draw/engine";
import { sceneToScreen, TEXT_FONT_FAMILY_CSS } from "@deviva-draw/engine";
import { shouldCommitOnEnter } from "./should-commit-on-enter";

export interface UseTextEditingOptions {
  session: TextEditSession;
  scene: Scene;
  /** Read fresh on every render — the same camera the canvas itself paints with, so the overlay tracks pan/zoom exactly. */
  getCamera: () => Camera;
  /**
   * Registers a listener fired whenever the camera actually changes (`camera-store.ts`'s
   * `CameraStore.subscribe`) — without this, a live pan/zoom while a text-edit session is open would
   * leave the overlay's position stale until *something else* (a session/scene change) happened to
   * force a React re-render. Optional so a host that hasn't wired a `CameraStore` yet still gets the
   * old "recompute on every render" behavior rather than a hard requirement; every composed
   * `<DevivaDraw/>` app shell always supplies it.
   */
  subscribeCamera?: (listener: () => void) => () => void;
}

export interface TextEditingOverlay {
  elementId: string;
  value: string;
  textAlign: TextAlign;
  /** Positions/rotates the overlay's wrapper `<div>` at the element's screen-space box. */
  containerStyle: CSSProperties;
  /** Font/color/wrap styling for the `<textarea>` itself. */
  textareaStyle: CSSProperties;
  /** `true` for standalone (non-wrapping) text — the component grows the textarea's width to fit the draft so long lines aren't clipped by the initial (near-zero) element width, since `updateDraft` never resizes the scene element mid-edit. `false` for bound text, which wraps within its container's fixed width instead. */
  autoWidth: boolean;
  onChange(value: string): void;
  onBlur(): void;
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
}

/** Smallest sensible screen-space box for a still-empty new text element, so the very first keystroke has somewhere visible to land in. */
const MIN_OVERLAY_SIZE_PX = 20;

function useForceRender(): () => void {
  const [, dispatch] = useReducer((count: number) => count + 1, 0);
  return dispatch;
}

/**
 * Returns the current overlay's derived state, or `null` when no session is open (the host renders
 * nothing in that case). Deliberately recomputed on every render rather than memoized — the geometry
 * depends on `getCamera()`, which lives outside React state, so a memo keyed only on session/scene
 * state would miss camera pans/zooms in between; the computation itself is a handful of arithmetic
 * ops, cheap enough to redo on every render this hook is asked to. What actually *triggers* a render
 * whenever the camera changes mid-edit (the bug `subscribeCamera` fixes: without it, the overlay's
 * position would drift stale during a live pan while editing, since neither `session` nor `scene`
 * emit anything for a pan-only change) is the third subscription below.
 */
export function useTextEditing(options: UseTextEditingOptions): TextEditingOverlay | null {
  const { session, scene, getCamera, subscribeCamera } = options;
  const forceRender = useForceRender();

  useEffect(() => session.subscribe(forceRender), [session, forceRender]);
  useEffect(() => scene.subscribe(forceRender), [scene, forceRender]);
  useEffect(() => subscribeCamera?.(forceRender), [subscribeCamera, forceRender]);

  const sessionState = session.getState();
  if (sessionState.status !== "editing") return null;
  const element = scene.getElement(sessionState.elementId);
  if (!element || element.type !== "text") return null;

  const camera = getCamera();
  const topLeft = sceneToScreen({ x: element.x, y: element.y }, camera);
  const widthPx = Math.max(element.width * camera.zoom, MIN_OVERLAY_SIZE_PX);
  const minHeightPx = Math.max(element.height * camera.zoom, element.fontSize * element.lineHeight * camera.zoom, MIN_OVERLAY_SIZE_PX);
  const fontSizePx = element.fontSize * camera.zoom;
  const isBound = element.containerId !== null;

  const containerStyle: CSSProperties = {
    position: "absolute",
    left: topLeft.x,
    top: topLeft.y,
    // Bound text keeps the container's fixed width so its textarea can wrap within it; standalone text
    // lets the container shrink-wrap the (component-grown) textarea instead of clipping it to the
    // element's near-zero initial width.
    ...(isBound ? { width: widthPx } : {}),
    zIndex: 10,
    ...(element.angle !== 0 ? { transform: `rotate(${element.angle}rad)`, transformOrigin: "top left" } : {}),
  };

  const textareaStyle: CSSProperties = {
    display: "block",
    width: isBound ? "100%" : "auto",
    ...(isBound ? {} : { minWidth: widthPx }),
    minHeight: minHeightPx,
    margin: 0,
    padding: 0,
    border: "none",
    outline: "none",
    resize: "none",
    overflow: "hidden",
    boxSizing: "border-box",
    // The canvas (static layer, via `textDraft`) is what actually paints the glyphs while editing, so
    // this textarea is a transparent input/caret layer stacked exactly over them — never a second,
    // slightly-differently-rasterized copy of the text. Only the caret is tinted (to the text color).
    backgroundColor: "transparent",
    color: "transparent",
    caretColor: element.strokeColor,
    fontSize: fontSizePx,
    fontFamily: TEXT_FONT_FAMILY_CSS[element.fontFamily],
    lineHeight: element.lineHeight,
    textAlign: element.textAlign,
    // Bound text wraps within the container's width (matches `text/bound-text-layout.ts`'s wrap
    // model); standalone text never wraps except at an explicit newline (matches
    // `text/text-measurement.ts`'s `wrapText` "maxWidth: Infinity" doc).
    whiteSpace: isBound ? "pre-wrap" : "pre",
    overflowWrap: isBound ? "break-word" : "normal",
  };

  return {
    elementId: element.id,
    value: sessionState.draftText,
    textAlign: element.textAlign,
    containerStyle,
    textareaStyle,
    autoWidth: !isBound,
    onChange: (value: string) => session.updateDraft(value),
    onBlur: () => session.commit(),
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        session.cancel();
        return;
      }

      // `isComposing` (plus the legacy `keyCode === 229` fallback some browsers/timing still need
      // — Safari in particular has historically reported `isComposing: false` for the very keydown
      // that confirms an IME candidate) guards against the Enter that accepts a Vietnamese/CJK IME
      // composition also committing the editor — see `should-commit-on-enter.ts`'s module doc.
      const isComposing = event.nativeEvent.isComposing || event.keyCode === 229;
      if (shouldCommitOnEnter(event.key, event.shiftKey, isComposing)) {
        // Plain Enter commits/exits (matches a chat-input-style "Enter to send"); Shift+Enter
        // inserts a newline via the textarea's own native handling (left alone here) — multi-line
        // text is still fully supported, just via the shifted chord instead of a bare Enter.
        event.preventDefault();
        session.commit();
      }
    },
  };
}
