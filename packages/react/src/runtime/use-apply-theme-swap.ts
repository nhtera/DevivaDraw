/**
 * Applies `canvas-color-inversion.ts`'s canvas-aware color swap whenever the theme mode actually
 * changes (never on the initial mount — a freshly-loaded scene must render exactly as saved, not get
 * "swapped" the instant the app boots into dark mode because the OS prefers it). Skipped entirely
 * while no runtime is mounted yet.
 */
import { useEffect, useRef } from "react";
import { applyThemeToSceneElements } from "../theme/canvas-color-inversion";
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
  }, [runtime, mode]);
}
