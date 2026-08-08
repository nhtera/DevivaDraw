/**
 * Desktop tool-selection toolbar: one button per `tool-actions.ts` entry, reading/writing through the
 * shared `ActionRegistry` (DRY: same actions the keyboard shortcuts and
 * command palette use). Active tool highlighting is driven by `ToolStateMachine.subscribe` (not a
 * poll), and each button's `title` shows its i18n label plus its platform-formatted shortcut.
 */
import { buttonStyle, panelStyle } from "./chrome-styles";
import { detectIsMac, formatShortcut } from "../actions/format-shortcut";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import { useToolVersion } from "../runtime/use-live-version";
import type { DevivaRuntime } from "../runtime/runtime-types";

/** Shared with `mobile/bottom-toolbar.tsx` so both layouts list the exact same tools in the exact same order. */
export const TOOL_ACTION_IDS = [
  "select-tool",
  "pan-tool",
  "rectangle-tool",
  "ellipse-tool",
  "diamond-tool",
  "line-tool",
  "arrow-tool",
  "freedraw-tool",
  "text-tool",
];

export interface ToolbarProps {
  runtime: DevivaRuntime;
}

export function Toolbar(props: ToolbarProps) {
  const { runtime } = props;
  const { t } = useTranslation();
  useToolVersion(runtime.toolStateMachine);
  const activeTool = runtime.toolStateMachine.getActiveToolName();
  const isMac = detectIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined);

  return (
    <div
      role="toolbar"
      aria-label={t("app.title")}
      style={{ ...panelStyle, display: "flex", gap: 2, padding: 4, position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)" }}
    >
      {TOOL_ACTION_IDS.map((id) => {
        const action = runtime.actionRegistry.get(id);
        if (!action) return null;
        // Action ids are `"<toolName>-tool"` by construction (see `tool-actions.ts`) — stripping the
        // suffix recovers the exact tool-name string `ToolStateMachine` was registered under.
        const isActive = activeTool === action.id.replace(/-tool$/, "");
        const title = action.shortcut ? `${t(action.labelKey)} (${formatShortcut(action.shortcut, isMac)})` : t(action.labelKey);
        return (
          <button
            key={id}
            type="button"
            data-testid={`toolbar-${id}`}
            title={title}
            aria-label={t(action.labelKey)}
            aria-pressed={isActive}
            style={buttonStyle(isActive)}
            onClick={() => runtime.actionRegistry.run(id, runtime)}
          >
            <Icon name={action.icon} />
          </button>
        );
      })}
    </div>
  );
}
