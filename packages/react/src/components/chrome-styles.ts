/**
 * Shared inline-style builders for the chrome components — every panel/button/dialog reads the same
 * `--dd-*` CSS variables `theme-provider.tsx` sets on the app shell's root, so light/dark theming is
 * "free" for every component built from these helpers instead of each one re-deriving colors. Kept as
 * plain functions (not a CSS-in-JS/Tailwind dependency — none is installed in this package, and the
 * chrome's styling surface is small enough that inline styles stay readable) so every chrome component
 * shares one visual language without a build-time styling toolchain.
 */
import type { CSSProperties } from "react";

export const panelStyle: CSSProperties = {
  background: "var(--dd-chrome-background-elevated)",
  color: "var(--dd-text-primary)",
  border: "1px solid var(--dd-chrome-border)",
  borderRadius: 8,
  boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
};

export function buttonStyle(active = false): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "6px 8px",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    background: active ? "var(--dd-accent)" : "transparent",
    color: active ? "var(--dd-accent-contrast)" : "var(--dd-text-primary)",
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
  zIndex: 100,
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
