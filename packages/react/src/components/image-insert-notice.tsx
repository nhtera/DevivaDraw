/**
 * "Your image was resized" / "that image could not go in" — the on-screen half of image insertion.
 *
 * Both of the messages this shows used to be `console.warn`, which is to say invisible: dropping a
 * phone photo appeared to do nothing at all, with no way to tell a rejected file from a missed drop.
 * A resize is worth saying out loud too — the user's image is now smaller than the one on their
 * disk, and finding that out later from a blurry export is worse than being told now.
 *
 * Transient, unlike the two persistent banners it shares `top-banner-stack.tsx` with
 * (`autosave-quota-banner`, `session-ended-notice`): those describe a state that is still true,
 * while this describes something that just happened. It auto-dismisses, and stays dismissible by
 * hand for anyone who reads faster than the timer.
 */
import { useEffect } from "react";
import { buttonStyle, chromeFontFamily, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import type { ImageInsertOutcome } from "../browser/image-insert-outcome";
import { useTranslation } from "../i18n/use-translation";

/** Long enough to read a sentence, short enough not to sit over the canvas while the user works. */
const AUTO_DISMISS_MS = 6000;

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function ImageInsertNotice(props: { outcome: ImageInsertOutcome; onDismiss(): void }) {
  const { outcome, onDismiss } = props;
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // Keyed on the outcome so a second insert restarts the clock rather than inheriting the first's.
  }, [outcome, onDismiss]);

  const isResized = outcome.kind === "resized";
  const message = isResized
    ? t("image.insert.resized").replace("{width}", String(outcome.resized.to.width)).replace("{height}", String(outcome.resized.to.height))
    : outcome.reason === "too-large"
      ? t("image.insert.tooLarge").replace("{limit}", formatMegabytes(outcome.limitBytes))
      : outcome.reason === "too-many-pixels"
        ? t("image.insert.tooManyPixels").replace("{width}", String(outcome.width)).replace("{height}", String(outcome.height))
        : t("image.insert.failed");

  return (
    <div
      data-testid="image-insert-notice"
      data-outcome={isResized ? "resized" : outcome.reason}
      role="status"
      className="dd-animate-in"
      style={{
        ...panelStyle,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        width: "auto",
        height: "auto",
        // A resize succeeded, so it is not styled as a warning; a rejection borrows the danger tone
        // the other two banners use for "your work is not where you think it is".
        ...(isResized ? {} : { borderColor: "var(--dd-danger, #c0392b)" }),
        fontSize: 13,
        fontFamily: chromeFontFamily,
        pointerEvents: "auto",
      }}
    >
      <span style={{ display: "inline-flex", flex: "none", color: isResized ? "var(--dd-text-secondary)" : "var(--dd-danger, #c0392b)" }}>
        <Icon name={isResized ? "image" : "alert"} size={14} />
      </span>
      <span>{message}</span>
      <button
        type="button"
        aria-label={t("shortcuts.close")}
        title={t("shortcuts.close")}
        onClick={onDismiss}
        style={{ ...buttonStyle(false), flex: "none", width: 24, height: 24, padding: 0 }}
        data-testid="image-insert-notice-dismiss"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
