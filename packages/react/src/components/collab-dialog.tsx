/**
 * Start/join/leave collaboration UI — driven entirely by `useCollabSession`'s return value (the same
 * "hook owns state, dialog only reads/dispatches" pattern `share-dialog.tsx` uses for the share-link
 * flow). Offers two entry points from a fresh (disconnected, no room) state: start a brand-new session
 * (mints a room + shows its link, same copy-to-clipboard UX as `share-dialog.tsx`) or join one via a
 * pasted room URL (`@deviva-draw/collab-client`'s `room-url.ts` scheme — the decryption key travels in
 * the URL fragment, this dialog never sees or transmits it separately).
 */
import { useState } from "react";
import { buttonStyle, dialogOverlayStyle, dialogStyle, inputStyle, labelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { LinkQrCode } from "./link-qr-code";
import type { TranslationKey } from "../i18n/catalog-en";
import { useTranslation } from "../i18n/use-translation";
import { canFollow } from "../hooks/use-collab-session";
import type { CollabErrorReason, UseCollabSessionResult } from "../hooks/use-collab-session";
import { useOfflineHint } from "../hooks/use-online";

export interface CollabDialogProps {
  collab: UseCollabSessionResult;
  onClose(): void;
}

const ERROR_KEY: Record<NonNullable<CollabErrorReason>, TranslationKey> = {
  "not-configured": "collab.error.notConfigured",
  "start-failed": "collab.error.startFailed",
  "join-failed": "collab.error.joinFailed",
};

export function CollabDialog(props: CollabDialogProps) {
  const { collab, onClose } = props;
  const { t } = useTranslation();
  const [joinUrl, setJoinUrl] = useState("");
  const [copied, setCopied] = useState<"editor" | "viewer" | null>(null);

  // Which link was copied, so two copy buttons cannot both flash "Copied".
  const copyLink = async (url: string, which: "editor" | "viewer") => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Soft failure — the link is still visible and manually selectable below (see `share-dialog.tsx`).
    }
  };

  const isActive = collab.status === "connected" || collab.status === "connecting";
  // Renders only in hosts that opted in (the desktop shell) — see `hooks/use-online.ts`.
  const offline = useOfflineHint();

  return (
    <div style={dialogOverlayStyle} onClick={onClose} data-testid="collab-dialog-overlay">
      <div style={dialogStyle} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={t("collab.dialog.title")} data-testid="collab-dialog">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong>{t("collab.dialog.title")}</strong>
          <button type="button" aria-label={t("shortcuts.close")} onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Icon name="close" />
          </button>
        </div>
        <p>{t("collab.dialog.description")}</p>

        {collab.error && (
          <p role="alert" data-testid="collab-dialog-error">
            {t(ERROR_KEY[collab.error])}
          </p>
        )}

        {offline && (
          <p role="status" data-testid="collab-dialog-offline" style={{ fontSize: 12, color: "var(--dd-text-secondary)" }}>
            {t("offline.hint")}
          </p>
        )}

        {!isActive && (
          <>
            {/* Hint-only, never disabled: navigator.onLine can false-negative on WKWebView after
                sleep/network changes, and a disabled button would have no recovery path — a real
                failure lands in the dialog's existing error state instead. */}
            <button type="button" style={{ marginBottom: 12 }} onClick={() => void collab.startSession()} data-testid="collab-dialog-start">
              {t("collab.dialog.start")}
            </button>
            <label style={labelStyle} htmlFor="collab-join-url">
              {t("collab.dialog.joinLabel")}
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                id="collab-join-url"
                type="text"
                value={joinUrl}
                onChange={(event) => setJoinUrl(event.target.value)}
                placeholder={t("collab.dialog.joinPlaceholder")}
                style={inputStyle}
                data-testid="collab-dialog-join-input"
              />
              <button type="button" onClick={() => void collab.joinSession(joinUrl)} disabled={!joinUrl} data-testid="collab-dialog-join">
                {t("collab.dialog.join")}
              </button>
            </div>
          </>
        )}

        {collab.status === "connecting" && <p data-testid="collab-dialog-connecting">{t("collab.dialog.connecting")}</p>}

        {collab.status === "connected" && collab.roomUrl && (
          <>
            {collab.viewerUrl && (
              <label style={labelStyle} htmlFor="collab-editor-url">
                {t("collab.dialog.editorLink")}
              </label>
            )}
            <input
              id="collab-editor-url"
              type="text"
              readOnly
              value={collab.roomUrl}
              style={inputStyle}
              data-testid="collab-dialog-link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button type="button" onClick={() => void copyLink(collab.roomUrl!, "editor")} data-testid="collab-dialog-copy">
                {copied === "editor" ? t("share.dialog.copied") : t("share.dialog.copy")}
              </button>
              <button type="button" onClick={collab.leaveSession} data-testid="collab-dialog-leave">
                {t("collab.dialog.leave")}
              </button>
            </div>

            {/* The viewer link is a secondary row, not a second equal choice: "copy the link" should stay
                one obvious action, with the read-only variant available to whoever wants it. Only the peer
                that started the session has one to offer. */}
            {collab.viewerUrl && (
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle} htmlFor="collab-viewer-url">
                  {t("collab.dialog.viewerLink")}
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    id="collab-viewer-url"
                    type="text"
                    readOnly
                    value={collab.viewerUrl}
                    style={inputStyle}
                    data-testid="collab-dialog-viewer-link"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button type="button" onClick={() => void copyLink(collab.viewerUrl!, "viewer")} data-testid="collab-dialog-copy-viewer">
                    {copied === "viewer" ? t("share.dialog.copied") : t("share.dialog.copy")}
                  </button>
                </div>
                <p style={{ ...labelStyle, marginTop: 4 }}>{t("collab.dialog.linksHint")}</p>
              </div>
            )}

            {collab.role === "viewer" && (
              <p role="status" data-testid="collab-dialog-viewer-role" style={{ fontSize: 12, color: "var(--dd-text-secondary)" }}>
                {t("collab.role.viewerHint")}
              </p>
            )}
            {/* The room link is long and typed by nobody: scanning it is how a phone joins the session. */}
            <LinkQrCode url={collab.roomUrl} label={t("collab.dialog.qrLabel")} testId="collab-qr" />
            <p style={labelStyle}>{t("collab.dialog.peersLabel", { count: collab.peers.length })}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {collab.peers.map((peer) => {
                const followed = collab.followedPeerId === peer.peerId;
                return (
                  <div key={peer.peerId} style={{ display: "flex", alignItems: "center", gap: 6, opacity: peer.idle ? 0.5 : 1 }} data-testid="collab-dialog-peer">
                    <span style={{ ...buttonStyle(false), width: 10, height: 10, padding: 0, borderRadius: "50%", background: peer.color }} />
                    <span style={{ flex: 1 }}>{peer.name}</span>
                    {/* Not every peer can be followed: one that has never published a viewport (an older
                        client) has nothing to follow, and one on another page would swing this canvas to
                        coordinates from a page nobody here is looking at. Both cases disable the button
                        rather than offering a mode that would immediately undo itself. */}
                    <button
                      type="button"
                      onClick={() => collab.follow(followed ? null : peer.peerId)}
                      disabled={!followed && !canFollow(peer, collab.localPageId)}
                      aria-pressed={followed}
                      data-testid="collab-dialog-follow"
                      style={{ fontSize: 12, padding: "2px 8px" }}
                    >
                      {t(followed ? "collab.follow.stop" : "collab.follow.follow")}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
