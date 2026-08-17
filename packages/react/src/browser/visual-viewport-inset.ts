/**
 * On-screen-keyboard occlusion tracking: when the keyboard opens on a touch device, the visual
 * viewport shrinks while the layout viewport (and the canvas, `position: fixed; inset: 0`) does not —
 * the difference is the strip of screen the keyboard covers. The text-editing hooks feed that inset
 * into a *camera pan* (never a CSS translate of the overlay: the textarea is transparent and its
 * position derives from the same camera the canvas paints the glyphs with, so only moving the camera
 * keeps caret and painted text together — and leaves the rotation transform intact).
 *
 * Pure helpers (`readKeyboardInsetPx`, `computeKeyboardPanDelta`) are unit tested; the hook is thin
 * `visualViewport`-listener wiring, untested by package convention (no jsdom).
 */
import { useEffect, useState } from "react";

/** Structural subset of `window.visualViewport` the reader needs — injectable for tests. */
export interface VisualViewportLike {
  height: number;
}

/**
 * Height (px) of the layout-viewport strip the keyboard occludes; 0 when no keyboard (or when the
 * difference is just mobile-browser chrome noise — collapsing URL bars produce small deltas too, so
 * anything under the threshold reads as "no keyboard").
 */
export function readKeyboardInsetPx(viewport: VisualViewportLike | null | undefined, layoutHeightPx: number): number {
  if (!viewport || layoutHeightPx <= 0) return 0;
  const inset = layoutHeightPx - viewport.height;
  return inset >= KEYBOARD_INSET_THRESHOLD_PX ? inset : 0;
}

/** Deltas smaller than this are browser-chrome resize noise, not a keyboard (the smallest iOS keyboards are ~200px). */
export const KEYBOARD_INSET_THRESHOLD_PX = 100;

/** Breathing room kept between the caret line and the keyboard edge after the pan. */
export const KEYBOARD_PAN_MARGIN_PX = 24;

/**
 * How far (px, downward wheel-pan convention — positive moves content up on screen) the camera must
 * pan so `overlayBottomPx` clears the keyboard-occluded region. 0 when nothing is occluded.
 */
export function computeKeyboardPanDelta(overlayBottomPx: number, viewportHeightPx: number, keyboardInsetPx: number, marginPx: number = KEYBOARD_PAN_MARGIN_PX): number {
  if (keyboardInsetPx <= 0 || viewportHeightPx <= 0) return 0;
  const visibleBottom = viewportHeightPx - keyboardInsetPx - marginPx;
  return overlayBottomPx > visibleBottom ? overlayBottomPx - visibleBottom : 0;
}

/**
 * Live keyboard inset, rAF-throttled and cleanly unsubscribed. Always 0 on desktop: gated on
 * `navigator.maxTouchPoints > 0` both because only touch devices have on-screen keyboards and
 * because `visualViewport` reporting in desktop webviews is unreliable.
 */
export function useKeyboardInsetPx(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport || navigator.maxTouchPoints === 0) return;
    const viewport = window.visualViewport;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      setInset(readKeyboardInsetPx(viewport, window.innerHeight));
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    viewport.addEventListener("resize", schedule);
    schedule();
    return () => {
      viewport.removeEventListener("resize", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return inset;
}
