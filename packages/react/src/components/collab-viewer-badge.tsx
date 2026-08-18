/**
 * States, on screen, that this session joined with a viewer link and therefore cannot edit.
 *
 * A sibling of `share-viewer-badge.tsx` rather than a mode of it, because the two say different things
 * and offer different ways out. A share-link viewer can "edit a copy" — the document is theirs to fork.
 * A live-room viewer has no such action: the room belongs to the person who started it, the relay is
 * what enforces the role, and no local button can change that. So this badge is informational, and the
 * only real exit is to leave the session from the collaboration dialog.
 *
 * Bottom-centre, matching the share badge's position. In the standalone app the two cannot coincide,
 * since `/s/…` (a share snapshot) and `/room/…` (a live room) are different routes. An embedder can
 * set `initialViewOnly` and `initialRoomUrl` together, though, and would then see both — each is
 * independently correct, so the overlap is a cosmetic edge, not a contradiction.
 */
import { chromeFontFamily, panelStyle, Z_LAYER } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";

export function CollabViewerBadge() {
  const { t } = useTranslation();

  return (
    <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: Z_LAYER.menu }}>
      <div
        data-testid="collab-viewer-badge"
        title={t("collab.role.viewerHint")}
        style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 12, fontFamily: chromeFontFamily, color: "var(--dd-text-secondary)" }}
      >
        <Icon name="view-only" size={13} />
        {t("collab.role.viewer")}
      </div>
    </div>
  );
}
