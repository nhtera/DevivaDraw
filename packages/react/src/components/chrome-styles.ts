/**
 * Shared inline-style builders for the chrome components — every panel/button/dialog reads the same
 * `--dd-*` CSS variables `theme-provider.tsx` sets on the app shell's root, so light/dark theming is
 * "free" for every component built from these helpers instead of each one re-deriving colors. Kept as
 * plain functions (not a CSS-in-JS/Tailwind dependency — none is installed in this package, and the
 * chrome's styling surface is small enough that inline styles stay readable) so every chrome component
 * shares one visual language without a build-time styling toolchain.
 */
import type { CSSProperties } from "react";

/** One radius scale for the whole chrome (Shape Consistency Lock): buttons/controls share `control`, floating surfaces use `panel`. */
export const RADIUS = { control: 8, panel: 12 } as const;

/**
 * Soft, background-tinted elevation (not a hard pure-black drop shadow) — two layers give a close
 * contact shadow plus a wider ambient one, the look modern floating chrome uses. The tint is a dark
 * neutral at low alpha, subtle enough to read on both the light and dark elevated surfaces.
 */
export const PANEL_SHADOW = "0 6px 24px rgba(15, 16, 20, 0.14), 0 1px 3px rgba(15, 16, 20, 0.10)";

/**
 * Stacking order for the floating chrome that can overlap. Only the tiers that actually cover each
 * other are named — the docked chrome (toolbar, panels, minimap, sidebar) keeps its own low values,
 * since it never overlaps these.
 *
 * `popover` above `menu` is the point of the ladder: a popover is opened *from* a menu or a panel, so
 * it has to clear whatever opened it. As a bare number chosen next to its own component it did not,
 * and the canvas-background swatches opened a color popover that the main menu then painted straight
 * over. Anything portalled to the app root belongs to one of these tiers.
 */
export const Z_LAYER = {
  /** Menus anchored to the chrome: the main menu, the canvas context menu. */
  menu: 90,
  /** The find bar, which overlays the toolbar. */
  findPanel: 95,
  /** Popovers opened from a menu, panel, or sidebar — above every one of them. */
  popover: 96,
  /** Modal dialogs and their scrim, above everything else. */
  dialog: 100,
} as const;

/** One font stack for all chrome text, so panels/buttons/hints stay visually consistent. */
export const chromeFontFamily = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export const panelStyle: CSSProperties = {
  background: "var(--dd-chrome-background-elevated)",
  color: "var(--dd-text-primary)",
  border: "1px solid var(--dd-chrome-border)",
  borderRadius: RADIUS.panel,
  boxShadow: PANEL_SHADOW,
  fontFamily: chromeFontFamily,
  fontSize: 13,
};

/**
 * `active` drives only the glyph weight here; the *background* (a soft accent tint when active, a hover
 * tint otherwise), the press/focus states, and their transitions live in the injected chrome
 * stylesheet (`chrome-stylesheet.ts`), keyed on `[aria-pressed="true"]` — CSS can express `:hover`/
 * `:focus-visible`/`:active`/reduced-motion, which an inline style object cannot. Every active button
 * therefore MUST also set `aria-pressed`, which is both what the stylesheet targets and the correct a11y
 * signal. The foreground stays the normal text color (not accent) so an active *label* keeps full WCAG
 * AA contrast against the translucent tint in both themes — the soft background + weight are the active
 * cue (the Excalidraw-style treatment), not a low-contrast accent-colored foreground.
 */
export function buttonStyle(active = false): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "6px 8px",
    border: "none",
    borderRadius: RADIUS.control,
    cursor: "pointer",
    color: "var(--dd-text-primary)",
    fontWeight: active ? 600 : 400,
    fontSize: 13,
    fontFamily: "inherit",
  };
}

export const disabledButtonStyle: CSSProperties = { opacity: 0.4, cursor: "default" };

export const dividerStyle: CSSProperties = { width: 1, alignSelf: "stretch", background: "var(--dd-chrome-border)", margin: "0 4px" };

export const dialogOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--dd-overlay-scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: Z_LAYER.dialog,
};

export const dialogStyle: CSSProperties = {
  ...panelStyle,
  width: "min(480px, 90vw)",
  maxHeight: "80vh",
  overflow: "auto",
  padding: 16,
};

export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--dd-chrome-border)",
  background: "var(--dd-chrome-background)",
  color: "var(--dd-text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
};

export const labelStyle: CSSProperties = { fontSize: 11, color: "var(--dd-text-secondary)", marginBottom: 4, display: "block" };
