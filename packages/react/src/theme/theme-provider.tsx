/**
 * React theme context: mode state (persisted, system-preference default) + resolved CSS-variable
 * tokens. Deliberately has zero dependency on `Scene`/`canvas-color-inversion.ts` — this provider only
 * owns "which mode is active and what its chrome tokens are", keeping it reusable even for a host
 * embedding just the chrome without a live scene yet. The canvas-color-swap side effect
 * (`applyThemeToSceneElements`) is wired up *outside* this provider, by `deviva-draw-shell.tsx`'s
 * `use-apply-theme-swap.ts` hook (which reads `useTheme().mode` and has its own "skip the very first
 * mount" guard) — not by this component, so it stays a plain, scene-agnostic mode/token store.
 * Not unit tested: pure React context/`matchMedia`/`localStorage` wiring with no logic left once
 * `theme-tokens.ts`/`theme-storage.ts` (both fully tested) are factored out.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ThemeMode, ThemeTokens } from "./theme-tokens";
import { resolveSystemThemeMode, resolveThemeTokens, toCssVariables } from "./theme-tokens";
import { readStoredThemeMode, writeStoredThemeMode } from "./theme-storage";

export interface ThemeContextValue {
  mode: ThemeMode;
  tokens: ThemeTokens;
  /** `tokens` as a `--dd-*` CSS custom-property map, ready to spread onto a root `style` object. */
  cssVariables: CSSProperties;
  setMode(mode: ThemeMode): void;
  toggleMode(): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** Explicit mode override — omit to fall back to the persisted preference, then the system's `prefers-color-scheme`. */
  theme?: ThemeMode;
  children: ReactNode;
}

function resolveInitialMode(explicit: ThemeMode | undefined): ThemeMode {
  if (explicit) return explicit;
  if (typeof window === "undefined") return "light";
  const stored = readStoredThemeMode(window.localStorage);
  if (stored) return stored;
  return resolveSystemThemeMode(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
}

export function ThemeProvider(props: ThemeProviderProps) {
  const { theme: explicitMode, children } = props;
  const [mode, setModeState] = useState<ThemeMode>(() => resolveInitialMode(explicitMode));

  useEffect(() => {
    if (explicitMode && explicitMode !== mode) setModeState(explicitMode);
  }, [explicitMode, mode]);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    if (typeof window !== "undefined") writeStoredThemeMode(window.localStorage, next);
  };
  const toggleMode = () => setMode(mode === "dark" ? "light" : "dark");

  const value = useMemo<ThemeContextValue>(() => {
    const tokens = resolveThemeTokens(mode);
    return { mode, tokens, cssVariables: toCssVariables(tokens) as CSSProperties, setMode, toggleMode };
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Reads the active theme — throws if used outside `<ThemeProvider/>` (a programmer error, not a runtime condition to degrade from). */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme: must be used within a <ThemeProvider/>");
  return context;
}
