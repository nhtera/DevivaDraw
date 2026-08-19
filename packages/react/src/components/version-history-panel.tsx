/**
 * The version history panel: every stored snapshot of this board, newest first, each one previewable
 * by sight and restorable in one click.
 *
 * A modal dialog rather than a docked panel like layers/pages, because what it does is not a view
 * toggle: restoring replaces the whole document, and that deserves the user's full attention and a
 * confirmation, not a click in the corner of a busy canvas.
 *
 * Three things here are load-bearing rather than decorative:
 *
 * 1. **The list renders from summaries.** `useVersionHistory` never loads a document to draw a row —
 *    a preview is fetched only for the entry the user actually asks to see.
 * 2. **Restore explains its refusal.** While a session is connected *or connecting* the button is
 *    disabled with the reason on screen. Hiding it, or letting it fail quietly, would leave the user
 *    to guess why the app ignored them. The real enforcement is inside
 *    `restore-version-snapshot.ts`; this is the part that is honest about it.
 * 3. **Deleting is offered as prominently as restoring.** A store that quietly retains board content
 *    with no way to empty it is not acceptable, particularly on a shared machine.
 */
import { useCallback, useState } from "react";
import { buttonStyle, dialogOverlayStyle, dialogStyle, inputStyle, labelStyle, outlineButtonStyle, sectionDividerStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useEscapeToClose } from "../hooks/use-escape-to-close";
import { useTranslation } from "../i18n/use-translation";
import type { UseVersionHistoryResult } from "../hooks/use-version-history";
import { VersionHistoryEntry } from "./version-history-entry";
import type { VersionSummary } from "../browser/version-snapshot-types";

export interface VersionHistoryPanelProps {
  history: UseVersionHistoryResult;
  /** `true` while a room session is connected or connecting — drives the disabled-and-explained restore state. */
  sessionActive: boolean;
  onClose(): void;
}

export function VersionHistoryPanel(props: VersionHistoryPanelProps) {
  const { history, sessionActive, onClose } = props;
  const { t } = useTranslation();
  useEscapeToClose(onClose);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingLabel, setSavingLabel] = useState<string | null>(null);

  const showPreview = useCallback(
    async (id: string) => {
      // Cached per entry: a stored version never changes, so re-rendering its thumbnail on every
      // click would be pure waste.
      if (id in previews) return;
      setPreviews((current) => ({ ...current, [id]: null }));
      const dataUrl = await history.preview(id);
      setPreviews((current) => ({ ...current, [id]: dataUrl }));
    },
    [history, previews],
  );

  const restore = useCallback(
    async (version: VersionSummary) => {
      setNotice(null);
      if (!window.confirm(t("versionHistory.restoreConfirm", { pages: version.pageCount }))) return;
      setBusyId(version.id);
      const outcome = await history.restore(version.id);
      setBusyId(null);
      if (outcome.ok) {
        onClose();
        return;
      }
      setNotice(outcome.reason === "in-session" ? t("versionHistory.restoreBlocked") : t("versionHistory.restoreFailed"));
    },
    [history, onClose, t],
  );

  const commitSave = useCallback(
    async (label: string) => {
      setSavingLabel(null);
      const trimmed = label.trim();
      if (trimmed === "") return;
      await history.saveVersion(trimmed);
    },
    [history],
  );

  return (
    <div style={dialogOverlayStyle} onClick={onClose} data-testid="version-history-overlay">
      <div className="dd-animate-in" style={{ ...dialogStyle, width: "min(560px, 92vw)" }} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={t("versionHistory.title")} data-testid="version-history-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{t("versionHistory.title")}</strong>
          <button type="button" aria-label={t("versionHistory.close")} data-testid="version-history-close" style={{ ...buttonStyle(false), padding: 4 }} onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </div>
        <p style={{ ...labelStyle, marginTop: 6 }}>{t("versionHistory.description")}</p>

        {history.stopped && (
          <p data-testid="version-history-stopped" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dd-danger, #c0392b)" }}>
            {t("versionHistory.stopped")}
          </p>
        )}
        {sessionActive && (
          <p data-testid="version-history-session-notice" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dd-text-secondary)" }}>
            {t("versionHistory.restoreBlocked")}
          </p>
        )}
        {notice && (
          <p data-testid="version-history-notice" role="status" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dd-text-secondary)" }}>
            {notice}
          </p>
        )}

        <div style={sectionDividerStyle} />

        {!history.available ? (
          // No IndexedDB at all — a private window, a locked-down embedding. Said out loud rather
          // than shown as an empty list, which would read as "you have no versions" when the truth
          // is "this browser will not let us keep any".
          <p data-testid="version-history-unavailable" style={{ margin: 0, fontSize: 12, color: "var(--dd-text-secondary)" }}>
            {t("versionHistory.unavailable")}
          </p>
        ) : (
          <>
        {savingLabel === null ? (
          <button type="button" data-testid="version-history-save" style={{ ...outlineButtonStyle(), width: "100%", justifyContent: "flex-start", gap: 8 }} onClick={() => setSavingLabel("")}>
            <Icon name="save" size={14} />
            {t("versionHistory.save")}
          </button>
        ) : (
          <div>
            <label style={labelStyle} htmlFor="dd-version-label">
              {t("versionHistory.saveLabelPrompt")}
            </label>
            <input
              id="dd-version-label"
              data-testid="version-history-save-input"
              autoFocus
              value={savingLabel}
              placeholder={t("versionHistory.saveLabelPlaceholder")}
              style={inputStyle}
              onChange={(event) => setSavingLabel(event.target.value)}
              onKeyDown={(event) => {
                // Stopped here so a letter typed into this field can never reach the global shortcut
                // resolver — the same defense-in-depth the command palette documents.
                event.stopPropagation();
                if (event.key === "Enter") void commitSave(savingLabel);
                if (event.key === "Escape") setSavingLabel(null);
              }}
              onBlur={() => void commitSave(savingLabel)}
            />
          </div>
        )}

        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: "46vh", overflowY: "auto" }} data-testid="version-history-list">
          {history.loading && <span style={{ fontSize: 12, color: "var(--dd-text-secondary)" }}>{t("versionHistory.loading")}</span>}
          {!history.loading && history.versions.length === 0 && (
            <span data-testid="version-history-empty" style={{ fontSize: 12, color: "var(--dd-text-secondary)" }}>
              {t("versionHistory.empty")}
            </span>
          )}
          {history.versions.map((version) => (
            <VersionHistoryEntry
              key={version.id}
              version={version}
              preview={previews[version.id]}
              sessionActive={sessionActive}
              busy={busyId !== null}
              onPreview={() => void showPreview(version.id)}
              onRestore={() => void restore(version)}
              onDelete={() => void history.remove(version.id)}
            />
          ))}
        </div>

        {history.versions.length > 0 && (
          <>
            <div style={sectionDividerStyle} />
            <button
              type="button"
              data-testid="version-history-clear"
              style={{ ...buttonStyle(false), width: "100%", justifyContent: "flex-start", gap: 8, color: "var(--dd-text-secondary)" }}
              onClick={() => {
                if (window.confirm(t("versionHistory.clearConfirm"))) void history.clearAll();
              }}
            >
              <Icon name="trash" size={13} />
              {t("versionHistory.clear")}
            </button>
          </>
        )}
          </>
        )}
      </div>
    </div>
  );
}
