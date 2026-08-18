/**
 * "The session ended" — shown when a live session stops for a reason the local user did not choose.
 *
 * Ending is otherwise silent. The peers vanish, the cursors stop, and the canvas keeps working
 * exactly as it did, so the only difference between "everyone went quiet" and "you are alone in a
 * document nobody else can see" is a distinction the user has no way to make. That is the whole
 * reason this exists: a collaborator who keeps drawing into a session that closed is doing work
 * other people will never receive.
 *
 * It says which of those happened, because the answers differ: a host who stopped hosting ended the
 * session deliberately and there is nothing to wait for, while an unreachable relay might be a
 * network that comes back. Not shown for leaving, which needs no announcement to the person who
 * chose it.
 *
 * Dismissible, and only dismissible — offering "reconnect" would be a button that cannot keep its
 * promise, since by this point the client has already established there is nothing to reconnect to.
 */
import { buttonStyle, chromeFontFamily, panelStyle, Z_LAYER } from "./chrome-styles";
import { Icon } from "./icon";
import type { GiveUpReason } from "@deviva-draw/collab-client";
import type { TranslationKey } from "../i18n/catalog-en";
import { useTranslation } from "../i18n/use-translation";

const REASON_KEY: Record<GiveUpReason, TranslationKey> = {
  "room-closed": "collab.ended.hostStopped",
  refused: "collab.ended.refused",
  unreachable: "collab.ended.unreachable",
};

export function SessionEndedNotice(props: { reason: GiveUpReason; onDismiss(): void }) {
  const { reason, onDismiss } = props;
  const { t } = useTranslation();

  return (
    <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: Z_LAYER.menu }}>
      <div
        data-testid="session-ended-notice"
        role="status"
        className="dd-animate-in"
        style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", fontSize: 13, fontFamily: chromeFontFamily }}
      >
        <Icon name="users" size={14} />
        <span>{t(REASON_KEY[reason])}</span>
        <button type="button" aria-label={t("shortcuts.close")} title={t("shortcuts.close")} onClick={onDismiss} style={{ ...buttonStyle(false), width: 22, height: 22, padding: 0 }} data-testid="session-ended-dismiss">
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}
