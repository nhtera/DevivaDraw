/**
 * Desktop tool-selection toolbar: one button per `tool-actions.ts` entry, reading/writing through the
 * shared `ActionRegistry` (DRY: same actions the keyboard shortcuts and
 * command palette use). Active tool highlighting is driven by `ToolStateMachine.subscribe` (not a
 * poll), and each button's `title` shows its i18n label plus its platform-formatted shortcut.
 */
import { buttonStyle, dividerStyle, panelStyle } from "./chrome-styles";
import { detectIsMac, formatShortcut } from "../actions/format-shortcut";
import { Icon } from "./icon";
import { MoreToolsMenu } from "./more-tools-menu";
import { useTranslation } from "../i18n/use-translation";
import { useToolVersion } from "../runtime/use-live-version";
import type { DevivaRuntime } from "../runtime/runtime-types";

/**
 * Tools grouped by purpose (navigation | shapes | connectors/freehand | text | eraser) so the toolbar
 * reads as clusters with thin dividers between them instead of one long undifferentiated row.
 */
const TOOL_GROUPS: readonly (readonly string[])[] = [
  ["select-tool", "pan-tool"],
  ["rectangle-tool", "ellipse-tool", "diamond-tool"],
  ["line-tool", "arrow-tool", "freedraw-tool"],
  ["text-tool", "note-tool", "eraser-tool"],
];

/** Flat list (group order preserved) — shared with `mobile/bottom-toolbar.tsx` so both layouts list the exact same tools in the exact same order. */
export const TOOL_ACTION_IDS = TOOL_GROUPS.flat();

export interface ToolbarProps {
  runtime: DevivaRuntime;
  /** Whether the tool lock is engaged — when on, a creation tool stays active after drawing instead of handing back to select. */
  toolLocked: boolean;
  onToggleLock(): void;
  /** Opens the OS file picker to insert an image — an action (opens a dialog), not a `ToolStateMachine` tool, so it's a plain button rather than a `renderTool` entry. */
  onInsertImage(): void;
}

export function Toolbar(props: ToolbarProps) {
  const { runtime, toolLocked, onToggleLock, onInsertImage } = props;
  const { t } = useTranslation();
  useToolVersion(runtime.toolStateMachine);
  const activeTool = runtime.toolStateMachine.getActiveToolName();
  const isMac = detectIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined);

  const renderTool = (id: string) => {
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
  };

  return (
    <div
      role="toolbar"
      aria-label={t("app.title")}
      // `transform: translateX(-50%)` makes this toolbar its own stacking context, which would trap the
      // More popover's z-index *inside* the toolbar — the later-painted `CanvasHint` (also a transformed
      // sibling) would then bleed over the open popover. A z-index here ranks the whole toolbar subtree
      // (popover included) above that hint. See `more-tools-menu.tsx`.
      data-testid="toolbar"
      // Anchor + shift are var-driven so the touch-density stylesheet can keep this centered bar
      // clear of the (also-grown) top bar on tablets: wide tablets clamp the left edge, narrower
      // ones drop the whole bar to a second row. The var always resolves to a transform, so the
      // stacking-context reasoning above still holds. See chrome-stylesheet.ts.
      style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 2, padding: 5, position: "absolute", top: "var(--dd-toolbar-top, calc(12px + env(safe-area-inset-top)))", left: "50%", transform: "var(--dd-toolbar-shift, translateX(-50%))", zIndex: 20 }}
    >
      <button
        type="button"
        data-testid="toolbar-lock"
        title={t("tool.lock")}
        aria-label={t("tool.lock")}
        aria-pressed={toolLocked}
        style={buttonStyle(toolLocked)}
        onClick={onToggleLock}
      >
        <Icon name="lock" />
      </button>
      <div style={dividerStyle} />
      {TOOL_GROUPS.map((group, index) => (
        <div key={group[0] ?? index} style={{ display: "contents" }}>
          {index > 0 && <div style={dividerStyle} />}
          {group.map(renderTool)}
        </div>
      ))}
      <div style={dividerStyle} />
      <button
        type="button"
        data-testid="toolbar-image"
        title={`${t("tool.image")} (9)`}
        aria-label={t("tool.image")}
        style={buttonStyle(false)}
        onClick={onInsertImage}
      >
        <Icon name="image" />
      </button>
      <MoreToolsMenu runtime={runtime} />
    </div>
  );
}
