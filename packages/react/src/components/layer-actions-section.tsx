/**
 * Layer-actions row of the properties panel: z-order, align/distribute, group/ungroup, lock/unlock —
 * every one a direct `ActionRegistry.run` call (already `isEnabled`-gated per action, see
 * `actions/z-order-actions.ts`/`arrange-actions.ts`), so this component owns no engine logic of its
 * own, only layout.
 */
import { buttonStyle, disabledButtonStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

const Z_ORDER_IDS = ["send-to-back", "send-backward", "bring-forward", "bring-to-front"];
const ALIGN_IDS = ["align-left", "align-center-h", "align-right", "align-top", "align-middle-v", "align-bottom"];
const DISTRIBUTE_IDS = ["distribute-horizontal", "distribute-vertical"];
const GROUP_IDS = ["group", "ungroup", "toggle-lock"];

/**
 * Columns every row is laid out on — the longest row's length. As a fixed-width flex row, the six
 * align buttons were wider than the panel's 194px content box, and since a scroll container computes
 * `overflow-x` alongside its `overflow-y`, that handful of pixels put a horizontal scrollbar under the
 * whole panel. Sharing one column track instead lets the buttons size themselves to whatever width the
 * container has (the desktop dock and the mobile sheet differ), and lines the shorter rows up with the
 * longer ones as a side benefit.
 */
const ACTION_COLUMNS = ALIGN_IDS.length;
/** Comfortable size for an icon button, and the gap between them — the grid shrinks below this to fit a narrow container, but never stretches past it (the mobile sheet is wide enough to strand the glyphs far apart otherwise). */
const ACTION_BUTTON_SIZE = 32;
const ACTION_GAP = 2;
const ACTION_ROW_MAX_WIDTH = ACTION_COLUMNS * ACTION_BUTTON_SIZE + (ACTION_COLUMNS - 1) * ACTION_GAP;

export interface LayerActionsSectionProps {
  runtime: DevivaRuntime;
}

function ActionRow(props: { runtime: DevivaRuntime; ids: string[] }) {
  const { runtime, ids } = props;
  const { t } = useTranslation();
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${ACTION_COLUMNS}, minmax(0, 1fr))`, gap: ACTION_GAP, maxWidth: ACTION_ROW_MAX_WIDTH }}>
      {ids.map((id) => {
        const action = runtime.actionRegistry.get(id);
        if (!action) return null;
        const enabled = runtime.actionRegistry.isEnabled(id, runtime);
        return (
          <button
            key={id}
            type="button"
            data-testid={`layer-action-${id}`}
            aria-label={t(action.labelKey)}
            title={t(action.labelKey)}
            disabled={!enabled}
            // No side padding: the column track already sets the width, and the shared button padding
            // would push the glyph out of a track this narrow.
            style={{ ...buttonStyle(false), padding: "6px 0", minWidth: 0, ...(enabled ? {} : disabledButtonStyle) }}
            onClick={() => runtime.actionRegistry.run(id, runtime)}
          >
            <Icon name={action.icon} />
          </button>
        );
      })}
    </div>
  );
}

export function LayerActionsSection(props: LayerActionsSectionProps) {
  const { runtime } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <ActionRow runtime={runtime} ids={Z_ORDER_IDS} />
      <ActionRow runtime={runtime} ids={ALIGN_IDS} />
      <ActionRow runtime={runtime} ids={DISTRIBUTE_IDS} />
      <div style={{ height: 1, background: "var(--dd-chrome-border)" }} />
      <ActionRow runtime={runtime} ids={GROUP_IDS} />
    </div>
  );
}
