/**
 * The shared-scene viewer's edit affordance, bottom-center: while the session is view-only, a
 * prominent "Edit a copy" pill (the capability existed before only as a buried main-menu toggle —
 * this makes it a first-class action); once editing, an always-visible "unsaved copy" chip, because
 * a share-viewer session has no autosave (`use-deviva-runtime` disables it for host-managed data) —
 * the copy lives in memory only, and pretending otherwise is how recipients lose work. Save/export
 * from the main menu is the durable exit, and the chip says so.
 */
import { buttonStyle, chromeFontFamily, panelStyle, Z_LAYER } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";

export interface ShareViewerBadgeProps {
  /** Current view-only state — pill while `true`, unsaved-copy chip once the user starts editing. */
  viewOnly: boolean;
  onEditCopy(): void;
}

export function ShareViewerBadge(props: ShareViewerBadgeProps) {
  const { viewOnly, onEditCopy } = props;
  const { t } = useTranslation();

  return (
    <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: Z_LAYER.menu }}>
      {viewOnly ? (
        <button
          type="button"
          data-testid="share-viewer-edit-copy"
          style={{ ...panelStyle, ...buttonStyle(false), display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 13, fontFamily: chromeFontFamily }}
          onClick={onEditCopy}
        >
          <Icon name="cursor" size={13} />
          {t("share.viewer.editCopy")}
        </button>
      ) : (
        <div
          data-testid="share-viewer-unsaved"
          style={{ ...panelStyle, padding: "6px 12px", fontSize: 12, fontFamily: chromeFontFamily, color: "var(--dd-text-secondary)" }}
        >
          {t("share.viewer.unsavedCopy")}
        </div>
      )}
    </div>
  );
}
