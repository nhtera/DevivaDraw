/**
 * Pure light/dark CSS-variable token tables for the UI chrome (panels, toolbar, menus, dialogs) plus
 * the canvas backdrop color. Deliberately a small, hand-picked palette (not a copy of any other
 * whiteboard app's exact values — clean-room by design): a neutral gray scale for
 * chrome surfaces/borders/text, one accent color for selection/focus, and a canvas background that
 * flips between near-white and near-black. `resolveThemeTokens` is the only place these values live,
 * so `theme-provider.tsx` and every component reading `var(--dd-*)` stay in sync by construction.
 */
export type ThemeMode = "light" | "dark";

export interface ThemeTokens {
  /** CSS custom-property values, keyed without the `--dd-` prefix (added by `toCssVariables`). */
  canvasBackground: string;
  chromeBackground: string;
  chromeBackgroundElevated: string;
  chromeBorder: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentContrast: string;
  danger: string;
  overlayScrim: string;
}

const LIGHT_TOKENS: ThemeTokens = {
  canvasBackground: "#ffffff",
  chromeBackground: "#f5f5f7",
  chromeBackgroundElevated: "#ffffff",
  chromeBorder: "#dcdee3",
  textPrimary: "#1b1c1f",
  textSecondary: "#5c5f66",
  accent: "#3457d5",
  accentContrast: "#ffffff",
  danger: "#c92a2a",
  overlayScrim: "rgba(15, 16, 20, 0.35)",
};

const DARK_TOKENS: ThemeTokens = {
  canvasBackground: "#121317",
  chromeBackground: "#1c1d21",
  chromeBackgroundElevated: "#26272c",
  chromeBorder: "#37383e",
  textPrimary: "#eceef1",
  textSecondary: "#a3a6ad",
  accent: "#6a8dff",
  accentContrast: "#0b0c10",
  danger: "#ff6b6b",
  overlayScrim: "rgba(0, 0, 0, 0.55)",
};

/** Resolves the full token set for `mode` — the single source `theme-provider.tsx` reads from. */
export function resolveThemeTokens(mode: ThemeMode): ThemeTokens {
  return mode === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
}

/** Converts a resolved token set to a `--dd-<kebab-key>` CSS custom-property map, ready to spread onto a `style` object. */
export function toCssVariables(tokens: ThemeTokens): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    const kebabKey = key.replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    variables[`--dd-${kebabKey}`] = value;
  }
  return variables;
}

/** Resolves the system color-scheme preference, defaulting to `"light"` when unavailable (SSR, older browsers). */
export function resolveSystemThemeMode(matchesDarkPreference: boolean | undefined): ThemeMode {
  return matchesDarkPreference ? "dark" : "light";
}
