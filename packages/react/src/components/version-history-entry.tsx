/**
 * One row of the version history panel: a preview the user can summon, what the version is and when
 * it was taken, and the two things they can do to it.
 *
 * Split from `version-history-panel.tsx` because the two answer different questions — the panel owns
 * the dialog, the list, and the operations that affect all of history; this owns how a single stored
 * version presents itself. The naming rules in particular (which labels are translated and which are
 * the user's own words) belong with the row that displays them.
 */
import { buttonStyle, disabledButtonStyle, outlineButtonStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import type { Translator } from "../i18n/translate";
import type { MilestoneReason, VersionSummary } from "../browser/version-snapshot-types";

/** The milestone reasons this build knows how to name. A label outside this set is either a user's own text or a code written by a newer build. */
const MILESTONE_REASONS: readonly MilestoneReason[] = ["before-open", "before-clear", "before-join", "before-restore"];

/**
 * What to call one entry.
 *
 * A `milestone` label is a stable code (see `MilestoneReason`) and is translated; a `manual` label is
 * the user's own words and is shown exactly as typed. `trigger` is what tells the two apart, so a
 * user who names a version "before-clear" still sees their own text. An unrecognised milestone code —
 * written by a newer build, read by an older one — falls back to the raw string, which is at least
 * something, rather than to nothing.
 */
export function entryTitle(version: VersionSummary, t: Translator): string {
  if (version.trigger === "manual") return version.label ?? t("versionHistory.trigger.manual");
  if (version.trigger === "milestone" && version.label) {
    return MILESTONE_REASONS.includes(version.label as MilestoneReason) ? t(`versionHistory.reason.${version.label as MilestoneReason}`) : version.label;
  }
  return t("versionHistory.trigger.auto");
}

/** Locale-aware date and time, falling back to the ISO string on a runtime with no formatter for it. */
function formatWhen(createdAt: number): string {
  try {
    return new Date(createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(createdAt).toISOString();
  }
}

export interface VersionHistoryEntryProps {
  version: VersionSummary;
  /** The rendered thumbnail, `null` while one is being produced or after one failed, `undefined` before it has been asked for. */
  preview: string | null | undefined;
  /** `true` while a room session is connected or connecting — restore is refused and says why. */
  sessionActive: boolean;
  /** `true` while any entry's restore is in flight, so a second click cannot start another. */
  busy: boolean;
  onPreview(): void;
  onRestore(): void;
  onDelete(): void;
}

export function VersionHistoryEntry(props: VersionHistoryEntryProps) {
  const { version, preview, sessionActive, busy, onPreview, onRestore, onDelete } = props;
  const { t } = useTranslation();
  const restoreDisabled = sessionActive || busy;

  return (
    <div data-testid={`version-entry-${version.id}`} style={{ border: "1px solid var(--dd-chrome-border)", borderRadius: 8, padding: 8, display: "flex", gap: 10 }}>
      <button
        type="button"
        data-testid={`version-preview-${version.id}`}
        aria-label={t("versionHistory.preview")}
        title={t("versionHistory.preview")}
        style={{ ...buttonStyle(false), flex: "none", width: 72, height: 54, padding: 0, overflow: "hidden", border: "1px solid var(--dd-chrome-border)" }}
        onClick={onPreview}
      >
        {preview ? (
          <img src={preview} alt="" data-testid={`version-thumbnail-${version.id}`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        ) : (
          <span style={{ fontSize: 10, color: "var(--dd-text-secondary)" }}>{preview === null ? t("versionHistory.previewUnavailable") : <Icon name="search" size={14} />}</span>
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div data-testid={`version-title-${version.id}`} style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entryTitle(version, t)}
        </div>
        <div style={{ fontSize: 11, color: "var(--dd-text-secondary)" }}>
          {formatWhen(version.createdAt)} · {t("versionHistory.pages", { count: version.pageCount })} · {t("versionHistory.elements", { count: version.elementCount })}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button
            type="button"
            data-testid={`version-restore-${version.id}`}
            disabled={restoreDisabled}
            title={sessionActive ? t("versionHistory.restoreBlocked") : undefined}
            style={{ ...outlineButtonStyle(), padding: "4px 10px", fontSize: 12, ...(restoreDisabled ? disabledButtonStyle : {}) }}
            onClick={onRestore}
          >
            {t("versionHistory.restore")}
          </button>
          <button type="button" data-testid={`version-delete-${version.id}`} aria-label={t("versionHistory.delete")} title={t("versionHistory.delete")} style={{ ...buttonStyle(false), padding: "4px 8px" }} onClick={onDelete}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
