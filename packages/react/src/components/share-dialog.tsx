/**
 * Share-link result dialog: shown while the "Share" action (`actions/share-actions.ts`) is generating
 * a link and once it's ready (or failed) — driven entirely by `runtime.ui`'s `ShareDialogState`
 * (`action-types.ts`), the same "the action handler writes state, this component only reads it"
 * pattern `shortcuts-dialog.tsx` uses for its own open/closed state, just with more than two states
 * worth distinguishing.
 */
import { useEffect, useState } from "react";
import { buttonStyle, dialogOverlayStyle, dialogStyle, inputStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import type { ShareDialogState } from "../actions/action-types";
import { revokeShareLink } from "../browser/share-link-client";
import { readShareLinkHistory, removeShareLinkHistoryEntry } from "../browser/share-link-history";
import type { ShareLinkHistoryEntry } from "../browser/share-link-history";

export interface ShareDialogProps {
  state: ShareDialogState;
  onClose(): void;
  /** Opens the live-collaboration dialog — offered next to the link because a snapshot link and a live session answer different needs, and users routinely reach for the wrong one. */
  onStartCollab?(): void;
  /** The collab-server base URL — needed for revocation DELETEs; absent (unconfigured host) hides the history section entirely, since none of its rows could act. */
  apiBaseUrl?: string;
}

export function ShareDialog(props: ShareDialogProps) {
  const { state, onClose, onStartCollab, apiBaseUrl } = props;
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // Re-read whenever a link lands: the dialog mounts at "generating", BEFORE the share action
  // appends the new entry, so the mount-time read alone would always miss the freshest link. Rows
  // disappear as revokes succeed. Only ids/tokens/metadata live here; urls with keys never persist.
  const [history, setHistory] = useState<ShareLinkHistoryEntry[]>(() => (typeof window !== "undefined" ? readShareLinkHistory(window.localStorage) : []));
  useEffect(() => {
    if (state.status === "ready" && typeof window !== "undefined") setHistory(readShareLinkHistory(window.localStorage));
  }, [state.status]);
  const [revokeErrors, setRevokeErrors] = useState<Record<string, string>>({});
  const [revoking, setRevoking] = useState<string | null>(null);
  // The freshly generated link is itself a history row; revoking THAT row must also kill the link
  // display above it — otherwise the input/Copy keep offering a url the user just watched die.
  const [currentRevoked, setCurrentRevoked] = useState(false);

  const revoke = async (entry: ShareLinkHistoryEntry) => {
    if (!apiBaseUrl || revoking !== null) return;
    setRevoking(entry.blobId);
    const result = await revokeShareLink({ apiBaseUrl, blobId: entry.blobId, deleteToken: entry.deleteToken });
    setRevoking(null);
    if (result.ok) {
      removeShareLinkHistoryEntry(window.localStorage, entry.blobId);
      setHistory((entries) => entries.filter((existing) => existing.blobId !== entry.blobId));
      if (state.status === "ready" && state.url.includes(`/s/${entry.blobId}`)) setCurrentRevoked(true);
      return;
    }
    // A 403 means the blob is still live — the row must stay so the failure is undeniable.
    setRevokeErrors((errors) => ({ ...errors, [entry.blobId]: t(result.reason === "not-revocable" ? "share.dialog.revokeFailedNotRevocable" : "share.dialog.revokeFailedNetwork") }));
  };

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
        {state.status === "ready" && currentRevoked && (
          <p data-testid="share-dialog-current-revoked" style={{ color: "var(--dd-text-secondary)" }}>
            {t("share.dialog.currentRevoked")}
          </p>
        )}
        {state.status === "ready" && !currentRevoked && (
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
        {apiBaseUrl && history.length > 0 && state.status !== "generating" && (
          <div data-testid="share-dialog-history" style={{ marginTop: 14, borderTop: "1px solid var(--dd-chrome-border)", paddingTop: 10 }}>
            <strong style={{ fontSize: 12 }}>{t("share.dialog.historyTitle")}</strong>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 180, overflowY: "auto" }}>
              {history.map((entry) => (
                <div key={entry.blobId} data-testid={`share-history-${entry.blobId}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ flex: 1, color: "var(--dd-text-secondary)" }}>
                    {t("share.dialog.historyMeta", { date: new Date(entry.createdAt).toLocaleDateString(), pages: entry.pageCount })}
                  </span>
                  {revokeErrors[entry.blobId] && (
                    <span role="alert" style={{ color: "var(--dd-text-secondary)", fontSize: 11 }}>
                      {revokeErrors[entry.blobId]}
                    </span>
                  )}
                  <button
                    type="button"
                    data-testid={`share-history-revoke-${entry.blobId}`}
                    style={{ ...buttonStyle(false), padding: "3px 8px", fontSize: 11 }}
                    disabled={revoking !== null}
                    onClick={() => void revoke(entry)}
                  >
                    {t("share.dialog.revoke")}
                  </button>
                </div>
              ))}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--dd-text-secondary)" }}>{t("share.dialog.historyOtherBrowsers")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
