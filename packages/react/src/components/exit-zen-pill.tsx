/**
 * The persistent way out of zen mode: a bottom-right pill shown for as long as zen is on.
 *
 * Zen hides the panel-class chrome, including the preference flyout the mode was switched on from —
 * without a dedicated affordance the only exit is a keyboard shortcut the user has to already know,
 * which turns a view preference into a trap. The pill states its own shortcut so the mouse-only exit
 * teaches the keyboard one.
 *
 * Escape deliberately does NOT exit zen: Escape already means "deselect / cancel the current
 * gesture" everywhere else on this canvas, and overloading it would make a mid-drawing cancel
 * silently tear the chrome back open.
 *
 * Styling mirrors `back-to-content-pill.tsx` (the shell's other floating pill) so the two read as
 * one family; the corner differs because they can be on screen simultaneously.
 */
import { buttonStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { detectIsMac, formatShortcut } from "../actions/format-shortcut";
import { useTranslation } from "../i18n/use-translation";

export interface ExitZenPillProps {
  onExit(): void;
}

export function ExitZenPill(props: ExitZenPillProps) {
  const { t } = useTranslation();
  const isMac = detectIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined);
  const label = t("zen.exit");

  return (
    <div style={{ position: "absolute", right: 16, bottom: 16, zIndex: 35 }}>
      <button
        type="button"
        data-testid="exit-zen-pill"
        className="dd-animate-in"
        title={label}
        aria-label={label}
        style={{ ...panelStyle, ...buttonStyle(false), display: "flex", alignItems: "center", gap: 6, width: "auto", height: "auto", padding: "8px 14px" }}
        onClick={props.onExit}
      >
        <Icon name="zen" />
        <span>{label}</span>
        <span style={{ fontSize: 11, color: "var(--dd-text-secondary)" }}>{formatShortcut("alt+z", isMac)}</span>
      </button>
    </div>
  );
}
