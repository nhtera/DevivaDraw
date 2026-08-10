/**
 * The toolbar's "More tools" overflow: a button that opens a compact icon-grid popover of the
 * secondary/less-frequent tools (extra shapes, highlighter, laser, lasso, frame), keeping the main
 * toolbar row uncluttered — the same pattern tldraw's `⌄` expander and Excalidraw's `⋯` menu use.
 * Reads/writes through the shared `ActionRegistry` exactly like `toolbar.tsx`, so these tools share the
 * command palette and keyboard shortcuts with the primary ones. Picking a tool runs its action and
 * closes the popover; the button itself shows active whenever the current tool lives in this menu.
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { buttonStyle, panelStyle, RADIUS } from "./chrome-styles";
import { detectIsMac, formatShortcut } from "../actions/format-shortcut";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import { useToolVersion } from "../runtime/use-live-version";
import type { DevivaRuntime } from "../runtime/runtime-types";

/** Action ids housed in the overflow popover, in grid order (extra shapes, block arrows, then specialty tools). */
export const MORE_TOOL_IDS: readonly string[] = [
  "triangle-tool",
  "hexagon-tool",
  "star-tool",
  "cloud-tool",
  "heart-tool",
  "x-box-tool",
  "check-box-tool",
  "block-arrow-right-tool",
  "block-arrow-left-tool",
  "block-arrow-up-tool",
  "block-arrow-down-tool",
  "highlighter-tool",
  "frame-tool",
  "laser-tool",
  "lasso-tool",
];

export interface MoreToolsMenuProps {
  runtime: DevivaRuntime;
  /** Which tool actions the popover holds. Defaults to the desktop overflow set. */
  toolIds?: readonly string[];
  /** Whether the popover opens below (desktop, top-docked toolbar) or above (mobile, bottom-docked bar). */
  placement?: "down" | "up";
  /** Grid column count. Desktop uses 4; the taller mobile sheet uses more. */
  columns?: number;
  /** Extra popover cell(s) after the tool grid (e.g. the mobile image button). Receives a `close` callback so the picker can dismiss the popover. */
  trailing?: (close: () => void) => ReactNode;
  /** Extra style merged into the trigger button — lets the mobile bar match its larger touch targets. */
  triggerStyle?: CSSProperties;
}

export function MoreToolsMenu(props: MoreToolsMenuProps) {
  const { runtime, toolIds = MORE_TOOL_IDS, placement = "down", columns = 4, trailing, triggerStyle } = props;
  const { t } = useTranslation();
  useToolVersion(runtime.toolStateMachine);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isMac = detectIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined);
  const activeTool = runtime.toolStateMachine.getActiveToolName();
  const activeToolActionId = `${activeTool}-tool`;
  const menuHoldsActiveTool = toolIds.includes(activeToolActionId);

  // Close on an outside click or Escape — standard popover dismissal.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const renderTool = (id: string) => {
    const action = runtime.actionRegistry.get(id);
    if (!action) return null;
    const isActive = activeTool === action.id.replace(/-tool$/, "");
    const title = action.shortcut ? `${t(action.labelKey)} (${formatShortcut(action.shortcut, isMac)})` : t(action.labelKey);
    return (
      <button
        key={id}
        type="button"
        data-testid={`more-${id}`}
        title={title}
        aria-label={t(action.labelKey)}
        aria-pressed={isActive}
        style={buttonStyle(isActive)}
        onClick={() => {
          runtime.actionRegistry.run(id, runtime);
          setOpen(false);
        }}
      >
        <Icon name={action.icon} />
      </button>
    );
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        data-testid="toolbar-more"
        title={t("tool.more")}
        aria-label={t("tool.more")}
        aria-haspopup="true"
        aria-expanded={open}
        aria-pressed={menuHoldsActiveTool}
        style={{ ...buttonStyle(menuHoldsActiveTool), ...triggerStyle }}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="more-tools-popover"
          className="dd-animate-in"
          style={{
            ...panelStyle,
            position: "absolute",
            // Open below for a top-docked toolbar, above for the bottom-docked mobile bar.
            ...(placement === "up" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }),
            right: 0,
            // Above the canvas hint text (and any other chrome) that sits just below the toolbar — without
            // a stacking priority the later-painted hint bleeds through this popover. See `chrome-styles`.
            zIndex: 30,
            padding: 6,
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 2,
            borderRadius: RADIUS.panel,
          }}
        >
          {toolIds.map(renderTool)}
          {trailing?.(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
