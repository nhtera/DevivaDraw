/**
 * Keeps the "next shape" style default legible against the current theme: when the theme mode changes,
 * the default stroke/background for shapes drawn *afterward* swaps to its theme counterpart (a near-
 * black default → its light counterpart in dark mode), so a freshly-drawn stroke — and the text
 * caret, which is a real DOM color the canvas render-adapter can't reach — is visible immediately.
 *
 * Deliberately NON-destructive: it only rewrites `ShapeStyleState`'s default, never existing scene
 * elements. Those are handled at render time (see `render-scene-to-canvas.ts`'s `adaptColors`), so
 * toggling the theme no longer mutates the scene or pollutes undo, and a scene loaded in either theme
 * renders correctly without ever being rewritten.
 */
import { useEffect, useRef } from "react";
import { adaptBackgroundColorForTheme, adaptStrokeColorForTheme } from "../theme/canvas-color-inversion";
import type { ThemeMode } from "../theme/theme-tokens";
import type { DevivaRuntime } from "./runtime-types";

export function useAdaptNextShapeStyle(runtime: DevivaRuntime | null, mode: ThemeMode): void {
  const isFirstRun = useRef(true);
  const previousMode = useRef(mode);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      previousMode.current = mode;
      return;
    }
    if (!runtime || mode === previousMode.current) return;
    previousMode.current = mode;
    const style = runtime.styleState.getStyle();
    runtime.styleState.setStyle({
      strokeColor: adaptStrokeColorForTheme(style.strokeColor, mode),
      backgroundColor: adaptBackgroundColorForTheme(style.backgroundColor, mode),
    });
  }, [runtime, mode]);
}
