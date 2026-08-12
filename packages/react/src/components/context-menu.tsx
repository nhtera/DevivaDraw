/**
 * Right-click (desktop) / long-press (mobile, via `mobile/touch-gesture-adapter.ts`'s `onLongPress`)
 * context menu — selection-aware actions from the same `ActionRegistry` the toolbar/shortcuts use.
 * A controlled component: `deviva-draw-app.tsx` owns the open/closed + screen-position state and
 * renders this only while open, closing it on Escape, an outside click, or after any action runs.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  ["flip-horizontal", "flip-vertical"],
  ["group", "ungroup", "toggle-lock"],
  ["add-to-library"],
];

/** Keeps the menu clear of the viewport edges when a right-click lands close to one. */
const EDGE_MARGIN = 8;

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

  // Right-clicking near an edge would otherwise open the menu partly off-screen, with its lower entries
  // unreachable — the taller the menu grows, the more of the canvas that covers. Measured after mount
  // (the height depends on how many actions rendered) and before paint, so the menu never appears in
  // the overflowing position first.
  const [position, setPosition] = useState(screenPoint);
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    // offsetWidth/offsetHeight, not getBoundingClientRect: the .dd-animate-in pop-in opens from
    // `scale(0.97)`, and this runs while that keyframe is on its first frame. A rect is the *painted*
    // box, so it reports the menu 3% smaller than it lands, and the clamp then seats it ~3% of its
    // height too low — enough to hang the last entry off the bottom edge. The offset* pair reports the
    // untransformed layout box, which is the size the menu will actually occupy once settled.
    const { offsetWidth: width, offsetHeight: height } = node;
    setPosition({
      x: Math.max(EDGE_MARGIN, Math.min(screenPoint.x, window.innerWidth - width - EDGE_MARGIN)),
      y: Math.max(EDGE_MARGIN, Math.min(screenPoint.y, window.innerHeight - height - EDGE_MARGIN)),
    });
  }, [screenPoint]);

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
      style={{
        ...panelStyle,
        position: "fixed",
        left: position.x,
        top: position.y,
        padding: 4,
        display: "flex",
        flexDirection: "column",
        minWidth: 160,
        // Bounding the height is what makes the clamp above reliable: on a viewport shorter than the
        // full action list, an unbounded menu exceeds `innerHeight - 2 * EDGE_MARGIN`, the clamp's
        // upper bound goes negative, and the EDGE_MARGIN floor wins — pinning the top on screen while
        // the tail runs off the bottom. Capping it here means the menu always fits, and the overflow
        // becomes a scroll instead of unreachable entries. Font metrics vary by platform, so the exact
        // viewport where this bites does too.
        //
        // `border-box` is load-bearing, not tidiness: panelStyle contributes a 1px border and this
        // adds 4px of padding, so under the default content-box the cap would still overflow by those
        // 10px. Scoped here rather than on the shared panelStyle, which other chrome sizes against.
        boxSizing: "border-box",
        maxHeight: `calc(100dvh - ${EDGE_MARGIN * 2}px)`,
        overflowY: "auto",
        zIndex: 90,
      }}
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
