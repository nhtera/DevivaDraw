/**
 * React theme context: the user's *preference* (light/dark/system) + the resolved `mode` (always a
 * concrete light/dark) and its CSS-variable tokens. A `system` preference resolves against
 * `prefers-color-scheme` and stays live — a `matchMedia` listener re-resolves the mode when the OS
 * flips while `system` is selected. Deliberately has zero dependency on `Scene`/`canvas-color-inversion.ts`:
 * this provider only owns "which mode is active and what its chrome tokens are". The canvas-color-swap
 * side effect is wired up outside, by `deviva-draw-shell.tsx`'s `use-apply-theme-swap.ts` (which reads
 * `useTheme().mode`, the resolved value). Not unit tested: pure React context/`matchMedia`/`localStorage`
 * wiring once `theme-tokens.ts`/`theme-storage.ts` (both tested) are factored out.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ThemeMode, ThemePreference, ThemeTokens } from "./theme-tokens";
import { resolveSystemThemeMode, resolveThemeTokens, toCssVariables } from "./theme-tokens";
import { readStoredThemePreference, writeStoredThemePreference } from "./theme-storage";

export interface ThemeContextValue {
  /** The user's choice: light, dark, or system. Drive the theme picker UI off this. */
  preference: ThemePreference;
  /** The resolved theme actually applied (system already collapsed to light/dark). Read this for anything that needs a concrete theme (canvas color swap, token lookups). */
  mode: ThemeMode;
  tokens: ThemeTokens;
  /** `tokens` as a `--dd-*` CSS custom-property map, ready to spread onto a root `style` object. */
  cssVariables: CSSProperties;
  setPreference(preference: ThemePreference): void;
  /** Toggles the *resolved* theme (dark↔light) and pins it as an explicit preference — the one-tap theme action. */
  toggleMode(): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** Explicit resolved-mode override — omit to fall back to the persisted preference, then `system`. */
  theme?: ThemeMode;
  children: ReactNode;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function prefersDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(DARK_QUERY).matches;
}

function resolveInitialPreference(explicit: ThemeMode | undefined): ThemePreference {
  if (explicit) return explicit;
  if (typeof window === "undefined") return "system";
  return readStoredThemePreference(window.localStorage) ?? "system";
}

export function ThemeProvider(props: ThemeProviderProps) {
  const { theme: explicitMode, children } = props;
  const [preference, setPreferenceState] = useState<ThemePreference>(() => resolveInitialPreference(explicitMode));
  // Tracks the live OS preference so a `system` selection re-resolves when the OS theme flips.
  const [systemMode, setSystemMode] = useState<ThemeMode>(() => resolveSystemThemeMode(prefersDark()));

  useEffect(() => {
    if (explicitMode && explicitMode !== preference) setPreferenceState(explicitMode);
  }, [explicitMode, preference]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemMode(resolveSystemThemeMode(query.matches));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    if (typeof window !== "undefined") writeStoredThemePreference(window.localStorage, next);
  };

  const mode: ThemeMode = preference === "system" ? systemMode : preference;
  const toggleMode = () => setPreference(mode === "dark" ? "light" : "dark");

  // `mode` already folds in both `preference` and `systemMode`, so `[preference, mode]` fully captures
  // what the context value depends on (`setPreference`/`toggleMode` only close over stable setters + `mode`).
  const value = useMemo<ThemeContextValue>(() => {
    const tokens = resolveThemeTokens(mode);
    return { preference, mode, tokens, cssVariables: toCssVariables(tokens) as CSSProperties, setPreference, toggleMode };
  }, [preference, mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Reads the active theme — throws if used outside `<ThemeProvider/>` (a programmer error, not a runtime condition to degrade from). */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme: must be used within a <ThemeProvider/>");
  return context;
}
