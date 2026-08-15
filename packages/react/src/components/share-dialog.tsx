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
  /** Re-runs the share flow with an optional ISO expiry — the first auto-generated link is always never-expiring; a bounded lifetime is a deliberate second step. */
  onRegenerate?(expiresAt?: string): void;
}

/** The offered lifetimes — never (default) plus two fixed windows; a free-form date would add a picker for a decision users make coarsely. */
const EXPIRY_CHOICES = [
  { value: "never", days: null, labelKey: "share.dialog.expiryNever" },
  { value: "7d", days: 7, labelKey: "share.dialog.expiry7d" },
  { value: "30d", days: 30, labelKey: "share.dialog.expiry30d" },
] as const;

export function ShareDialog(props: ShareDialogProps) {
  const { state, onClose, onStartCollab, apiBaseUrl, onRegenerate } = props;
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [expiryChoice, setExpiryChoice] = useState<(typeof EXPIRY_CHOICES)[number]["value"]>("never");
  // Re-read whenever a link lands: the dialog mounts at "generating", BEFORE the share action
  // appends the new entry, so the mount-time read alone would always miss the freshest link. Rows
  // disappear as revokes succeed. Only ids/tokens/metadata live here; urls with keys never persist.
  const [history, setHistory] = useState<ShareLinkHistoryEntry[]>(() => (typeof window !== "undefined" ? readShareLinkHistory(window.localStorage) : []));
  useEffect(() => {
    if (state.status !== "ready") return;
    if (typeof window !== "undefined") setHistory(readShareLinkHistory(window.localStorage));
    // A fresh link just landed (first generation or a regenerate) — stale per-link flags from the
    // previous link must not leak onto it: `currentRevoked` would hide the NEW link behind the
    // "revoked" notice, and `copied` would claim it was already copied.
    setCurrentRevoked(false);
    setCopied(false);
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
    // A 403 means the blob is still live — the row must stay so the failure is undeniable. Each
    // reason gets its own guidance: telling a rate-limited user to "check your connection" sends
    // them debugging the wrong thing.
    const messageKey =
      result.reason === "not-revocable" ? "share.dialog.revokeFailedNotRevocable" : result.reason === "rate-limited" ? "share.dialog.revokeFailedRateLimited" : "share.dialog.revokeFailedNetwork";
    setRevokeErrors((errors) => ({ ...errors, [entry.blobId]: t(messageKey) }));
  };

  // Date AND time: dialog opens routinely mint several same-day links, and date-only rows would be
  // indistinguishable from each other — the one list where "which link is this?" must have an answer.
  const formatInstant = (epochOrIso: number | string) => new Date(epochOrIso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

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
        {state.status === "idle" && (
          <p data-testid="share-dialog-idle" style={{ fontSize: 13, color: "var(--dd-text-secondary)" }}>
            {t("share.dialog.idleHint")}
          </p>
        )}
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
        {state.status !== "generating" && state.status !== "closed" && onRegenerate && (
          // One control for every settled state: the idle dialog's explicit "Create link" (opening
          // the dialog never mints — see `ShareDialogState`), the ready state's "Generate new link",
          // and the error state's retry (without it, a failed generation dead-ends the dialog).
          // Deliberately OUTSIDE the revoked/not-revoked fork: after revoking the displayed link,
          // generating a replacement is the most likely next step — hiding this row would dead-end
          // the dialog.
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12 }}>
            <label htmlFor="share-expiry-select" style={{ color: "var(--dd-text-secondary)" }}>
              {t("share.dialog.expiryLabel")}
            </label>
            <select id="share-expiry-select" data-testid="share-dialog-expiry" value={expiryChoice} onChange={(event) => setExpiryChoice(event.target.value as typeof expiryChoice)} style={{ ...inputStyle, width: "auto", padding: "3px 6px", fontSize: 12 }}>
              {EXPIRY_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {t(choice.labelKey)}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="share-dialog-regenerate"
              style={{ ...buttonStyle(false), padding: "4px 8px", fontSize: 12, fontWeight: state.status !== "ready" ? 600 : undefined }}
              onClick={() => {
                const days = EXPIRY_CHOICES.find((choice) => choice.value === expiryChoice)?.days ?? null;
                onRegenerate(days === null ? undefined : new Date(Date.now() + days * 86_400_000).toISOString());
              }}
            >
              {t(state.status === "ready" ? "share.dialog.regenerate" : "share.dialog.generate")}
            </button>
          </div>
        )}
        {apiBaseUrl && history.length > 0 && state.status !== "generating" && (
          <div data-testid="share-dialog-history" style={{ marginTop: 14, borderTop: "1px solid var(--dd-chrome-border)", paddingTop: 10 }}>
            <strong style={{ fontSize: 12 }}>{t("share.dialog.historyTitle")}</strong>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 180, overflowY: "auto" }}>
              {history.map((entry) => (
                <div key={entry.blobId} data-testid={`share-history-${entry.blobId}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ flex: 1, color: "var(--dd-text-secondary)" }}>
                    {t("share.dialog.historyMeta", { date: formatInstant(entry.createdAt), pages: entry.pageCount })}
                    {entry.expiresAt !== undefined && ` · ${t("share.dialog.historyExpires", { date: formatInstant(entry.expiresAt) })}`}
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
                    aria-busy={revoking === entry.blobId}
                    onClick={() => void revoke(entry)}
                  >
                    {revoking === entry.blobId ? "…" : t("share.dialog.revoke")}
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
