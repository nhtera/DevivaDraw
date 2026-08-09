/**
 * Applies `canvas-color-inversion.ts`'s canvas-aware color swap whenever the theme mode actually
 * changes (never on the initial mount — a freshly-loaded scene must render exactly as saved, not get
 * "swapped" the instant the app boots into dark mode because the OS prefers it). Skipped entirely
 * while no runtime is mounted yet.
 */
import { useEffect, useRef } from "react";
import { adaptBackgroundColorForTheme, adaptStrokeColorForTheme, applyThemeToSceneElements } from "../theme/canvas-color-inversion";
import type { ThemeMode } from "../theme/theme-tokens";
import type { DevivaRuntime } from "./runtime-types";

export function useApplyThemeSwap(runtime: DevivaRuntime | null, mode: ThemeMode): void {
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
    applyThemeToSceneElements(runtime.scene, mode, runtime.history);
    // Adapt the "next shape" style default too (same default-palette-only swap the scene got), so a
    // shape drawn *after* the theme change is legible against the new canvas instead of inheriting the
    // previous theme's stroke — mirrors `build-tools.ts`'s mount-time initialization.
    const style = runtime.styleState.getStyle();
    runtime.styleState.setStyle({
      strokeColor: adaptStrokeColorForTheme(style.strokeColor, mode),
      backgroundColor: adaptBackgroundColorForTheme(style.backgroundColor, mode),
    });
  }, [runtime, mode]);
}
