/**
 * Mobile/narrow-viewport chrome variant of `toolbar.tsx` — same `ActionRegistry` wiring, docked to the
 * bottom of the viewport. Instead of scrolling the full tool list off-screen, it shows a curated
 * primary set that fits a phone's width and pushes everything else into a "More" popover that opens
 * upward (the bar is bottom-docked), matching how Excalidraw/tldraw handle a phone toolbar.
 */
import { buttonStyle, panelStyle } from "../chrome-styles";
import { Icon } from "../icon";
import { MoreToolsMenu, MORE_TOOL_IDS } from "../more-tools-menu";
import { TOOL_ACTION_IDS } from "../toolbar";
import { useTranslation } from "../../i18n/use-translation";
import { useToolVersion } from "../../runtime/use-live-version";
import type { DevivaRuntime } from "../../runtime/runtime-types";

/** The always-visible primary tools — the few every session reaches for, sized to fit a phone row. */
const MOBILE_PRIMARY_IDS: readonly string[] = [
  "select-tool",
  "rectangle-tool",
  "ellipse-tool",
  "arrow-tool",
  "freedraw-tool",
  "text-tool",
  "eraser-tool",
];

/** Everything else lives in the upward "More" popover: the remaining primary tools first, then the desktop overflow set — so every tool stays reachable, none scroll off-screen. */
const MOBILE_MORE_IDS: readonly string[] = [
  ...TOOL_ACTION_IDS.filter((id) => !MOBILE_PRIMARY_IDS.includes(id)),
  ...MORE_TOOL_IDS,
];

/** Larger touch target for the phone bar than the desktop default. */
const touchButtonStyle = (active: boolean) => ({ ...buttonStyle(active), flex: "0 0 auto" as const, padding: 10 });

export interface BottomToolbarProps {
  runtime: DevivaRuntime;
  /** Opens the OS file picker to insert an image — see `toolbar.tsx`'s `onInsertImage`. */
  onInsertImage(): void;
}

export function BottomToolbar(props: BottomToolbarProps) {
  const { runtime, onInsertImage } = props;
  const { t } = useTranslation();
  useToolVersion(runtime.toolStateMachine);
  const activeTool = runtime.toolStateMachine.getActiveToolName();

  const renderTool = (id: string) => {
    const action = runtime.actionRegistry.get(id);
    if (!action) return null;
    const isActive = activeTool === action.id.replace(/-tool$/, "");
    return (
      <button
        key={id}
        type="button"
        data-testid={`bottom-toolbar-${id}`}
        aria-label={t(action.labelKey)}
        aria-pressed={isActive}
        style={touchButtonStyle(isActive)}
        onClick={() => runtime.actionRegistry.run(id, runtime)}
      >
        <Icon name={action.icon} size={20} />
      </button>
    );
  };

  return (
    <div
      role="toolbar"
      aria-label={t("app.title")}
      // A centered pill sized to its curated content (like the top toolbar), capped at the viewport
      // width. Overflow is left `visible` on purpose: the upward "More" popover extends above this bar,
      // and any clipping here (e.g. `overflow: auto`) would hide it. `transform` makes this a stacking
      // context, so `zIndex` keeps the popover above the canvas hint (same reasoning as `toolbar.tsx`).
      style={{
        ...panelStyle,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: 4,
        position: "fixed",
        bottom: 8,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "calc(100vw - 16px)",
        zIndex: 20,
      }}
    >
      {MOBILE_PRIMARY_IDS.map(renderTool)}
      <MoreToolsMenu
        runtime={runtime}
        toolIds={MOBILE_MORE_IDS}
        placement="up"
        columns={5}
        triggerStyle={{ padding: 10 }}
        trailing={(close) => (
          <button
            type="button"
            data-testid="bottom-toolbar-image"
            aria-label={t("tool.image")}
            style={{ ...buttonStyle(false), width: "100%" }}
            onClick={() => {
              onInsertImage();
              close();
            }}
          >
            <Icon name="image" />
          </button>
        )}
      />
    </div>
  );
}
