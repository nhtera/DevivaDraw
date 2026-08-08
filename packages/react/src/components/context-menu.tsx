/**
 * Right-click (desktop) / long-press (mobile, via `mobile/touch-gesture-adapter.ts`'s `onLongPress`)
 * context menu — selection-aware actions from the same `ActionRegistry` the toolbar/shortcuts use.
 * A controlled component: `deviva-draw-app.tsx` owns the open/closed + screen-position state and
 * renders this only while open, closing it on Escape, an outside click, or after any action runs.
 */
import { useEffect, useRef } from "react";
import { panelStyle, buttonStyle, disabledButtonStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

const MENU_ACTION_IDS = ["copy", "paste", "duplicate", "delete", "bring-to-front", "bring-forward", "send-backward", "send-to-back", "group", "ungroup", "toggle-lock"];

export interface ContextMenuProps {
  runtime: DevivaRuntime;
  screenPoint: { x: number; y: number };
  onClose(): void;
}

export function ContextMenu(props: ContextMenuProps) {
  const { runtime, screenPoint, onClose } = props;
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);

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
      style={{ ...panelStyle, position: "fixed", left: screenPoint.x, top: screenPoint.y, padding: 4, display: "flex", flexDirection: "column", minWidth: 160, zIndex: 90 }}
    >
      {MENU_ACTION_IDS.map((id) => {
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
            style={{ ...buttonStyle(false), ...(enabled ? {} : disabledButtonStyle), justifyContent: "flex-start", width: "100%" }}
            onClick={() => {
              runtime.actionRegistry.run(id, runtime);
              onClose();
            }}
          >
            <Icon name={action.icon} />
            {t(action.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
