/**
 * Right-click (desktop) / long-press (mobile, via `mobile/touch-gesture-adapter.ts`'s `onLongPress`)
 * context menu — selection-aware actions from the same `ActionRegistry` the toolbar/shortcuts use.
 * A controlled component: `deviva-draw-app.tsx` owns the open/closed + screen-position state and
 * renders this only while open, closing it on Escape, an outside click, or after any action runs.
 */
import { useEffect, useRef } from "react";
import { panelStyle, buttonStyle, disabledButtonStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { detectIsMac, formatShortcut } from "../actions/format-shortcut";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

/**
 * Menu contents as groups, rendered with a separator between each — a flat 13-item list gave the eye
 * nothing to anchor on.
 */
const MENU_ACTION_GROUPS: readonly (readonly string[])[] = [
  ["copy", "paste", "copy-styles", "paste-styles"],
  ["duplicate", "delete"],
  ["bring-to-front", "bring-forward", "send-backward", "send-to-back"],
  ["group", "ungroup", "toggle-lock"],
];

export interface ContextMenuProps {
  runtime: DevivaRuntime;
  screenPoint: { x: number; y: number };
  onClose(): void;
}

export function ContextMenu(props: ContextMenuProps) {
  const { runtime, screenPoint, onClose } = props;
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isMac = detectIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="context-menu"
      className="dd-animate-in"
      style={{ ...panelStyle, position: "fixed", left: screenPoint.x, top: screenPoint.y, padding: 4, display: "flex", flexDirection: "column", minWidth: 160, zIndex: 90 }}
    >
      {MENU_ACTION_GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} style={{ display: "contents" }}>
          {groupIndex > 0 && <div style={{ height: 1, background: "var(--dd-chrome-border)", margin: "4px 0" }} />}
          {group.map((id) => {
            const action = runtime.actionRegistry.get(id);
            if (!action) return null;
            const enabled = runtime.actionRegistry.isEnabled(id, runtime);
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                data-testid={`context-menu-${id}`}
                disabled={!enabled}
                style={{ ...buttonStyle(false), ...(enabled ? {} : disabledButtonStyle), justifyContent: "flex-start", width: "100%", gap: 8 }}
                onClick={() => {
                  runtime.actionRegistry.run(id, runtime);
                  onClose();
                }}
              >
                <Icon name={action.icon} />
                <span>{t(action.labelKey)}</span>
                {/* Shortcut read from the same registry the shortcuts dialog uses, so the two can never
                    drift — and this menu becomes where the shortcuts are learned, as in Excalidraw. */}
                {action.shortcut && (
                  <span style={{ marginLeft: "auto", paddingLeft: 12, color: "var(--dd-text-secondary)", fontSize: 11 }}>
                    {formatShortcut(action.shortcut, isMac)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
