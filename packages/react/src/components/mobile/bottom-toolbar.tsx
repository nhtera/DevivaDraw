/**
 * Mobile/narrow-viewport chrome variant of `toolbar.tsx` — same `TOOL_ACTION_IDS`/`ActionRegistry`
 * wiring, docked to the bottom of the viewport and horizontally scrollable instead of a fixed
 * top-centered row (responsive layout + bottom toolbar for narrow viewports).
 */
import { buttonStyle, panelStyle } from "../chrome-styles";
import { Icon } from "../icon";
import { MORE_TOOL_IDS } from "../more-tools-menu";
import { TOOL_ACTION_IDS } from "../toolbar";
import { useTranslation } from "../../i18n/use-translation";
import { useToolVersion } from "../../runtime/use-live-version";
import type { DevivaRuntime } from "../../runtime/runtime-types";

/** Every tool the bottom bar lists, in order: the primary set, then the overflow set (the narrow bar scrolls, so no popover is needed here — everything fits inline). */
const BOTTOM_TOOLBAR_IDS: readonly string[] = [...TOOL_ACTION_IDS, ...MORE_TOOL_IDS];

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

  return (
    <div
      role="toolbar"
      aria-label={t("app.title")}
      style={{
        ...panelStyle,
        display: "flex",
        gap: 2,
        padding: 4,
        position: "fixed",
        left: 8,
        right: 8,
        bottom: 8,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {BOTTOM_TOOLBAR_IDS.map((id) => {
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
            style={{ ...buttonStyle(isActive), flex: "0 0 auto", padding: 10 }}
            onClick={() => runtime.actionRegistry.run(id, runtime)}
          >
            <Icon name={action.icon} size={20} />
          </button>
        );
      })}
      <button
        type="button"
        data-testid="bottom-toolbar-image"
        aria-label={t("tool.image")}
        style={{ ...buttonStyle(false), flex: "0 0 auto", padding: 10 }}
        onClick={onInsertImage}
      >
        <Icon name="image" size={20} />
      </button>
    </div>
  );
}
