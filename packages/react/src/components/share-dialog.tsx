/**
 * Share-link result dialog: shown while the "Share" action (`actions/share-actions.ts`) is generating
 * a link and once it's ready (or failed) — driven entirely by `runtime.ui`'s `ShareDialogState`
 * (`action-types.ts`), the same "the action handler writes state, this component only reads it"
 * pattern `shortcuts-dialog.tsx` uses for its own open/closed state, just with more than two states
 * worth distinguishing.
 */
import { useState } from "react";
import { dialogOverlayStyle, dialogStyle, inputStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import type { ShareDialogState } from "../actions/action-types";

export interface ShareDialogProps {
  state: ShareDialogState;
  onClose(): void;
  /** Opens the live-collaboration dialog — offered next to the link because a snapshot link and a live session answer different needs, and users routinely reach for the wrong one. */
  onStartCollab?(): void;
}

export function ShareDialog(props: ShareDialogProps) {
  const { state, onClose, onStartCollab } = props;
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The Clipboard API can be denied/unavailable (permissions, insecure context) — the link is
      // still visible and manually selectable in the dialog's own input, so this is a soft failure,
      // not fatal to the share flow itself.
    }
  };

  return (
    <div style={dialogOverlayStyle} onClick={onClose} data-testid="share-dialog-overlay">
      <div style={dialogStyle} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={t("share.dialog.title")} data-testid="share-dialog">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong>{t("share.dialog.title")}</strong>
          <button type="button" aria-label={t("shortcuts.close")} onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Icon name="close" />
          </button>
        </div>
        {state.status === "generating" && <p data-testid="share-dialog-generating">{t("share.dialog.generating")}</p>}
        {state.status === "error" && (
          <p role="alert" data-testid="share-dialog-error">
            {t("share.dialog.error")}
          </p>
        )}
        {state.status === "ready" && (
          <>
            <p>{t("share.dialog.description")}</p>
            <input
              type="text"
              readOnly
              value={state.url}
              style={inputStyle}
              data-testid="share-dialog-link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" style={{ marginTop: 8 }} onClick={() => copyLink(state.url)} data-testid="share-dialog-copy">
              {copied ? t("share.dialog.copied") : t("share.dialog.copy")}
            </button>
            <p data-testid="share-dialog-snapshot-note" style={{ marginTop: 10, fontSize: 12, color: "var(--dd-text-secondary)" }}>
              {t("share.dialog.snapshotNote")}
            </p>
            {onStartCollab && (
              <button type="button" data-testid="share-dialog-start-collab" style={{ marginTop: 4 }} onClick={onStartCollab}>
                {t("share.dialog.startCollab")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
