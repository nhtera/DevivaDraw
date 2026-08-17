/**
 * "Browser storage is full — autosave has stopped" warning, top-center.
 *
 * The failure it reports is the quiet one: when localStorage rejects a write, the board keeps
 * accepting edits and looks completely healthy, so the only signal the user would otherwise get is
 * an empty canvas after the next reload. This banner exists to make that impossible — it stays up
 * for as long as saving is broken and retracts itself the moment a write lands again (freeing space,
 * or deleting the oversized image, both count).
 *
 * It carries the fix rather than only the diagnosis: saving to a file is the one action that keeps
 * the work no matter what storage does, so the banner offers it directly instead of leaving the user
 * to find it in the menu.
 *
 * Shown even in zen mode — hiding a data-loss warning to keep the canvas tidy is the wrong trade.
 */
import { useEffect, useReducer } from "react";
import { buttonStyle, chromeFontFamily, panelStyle, Z_LAYER } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import type { AutosaveStatusStore } from "../runtime/autosave-status-store";

export interface AutosaveQuotaBannerProps {
  status: AutosaveStatusStore;
  /** Runs the "save to a file" escape hatch — the banner knows nothing about how saving works. */
  onSave(): void;
}

export function AutosaveQuotaBanner(props: AutosaveQuotaBannerProps) {
  const { status, onSave } = props;
  const { t } = useTranslation();
  // Same subscribe-and-bump idiom as `use-live-version.ts`: the store is plain pub-sub, and it only
  // notifies on an actual transition, so this re-renders twice a session at worst.
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => status.subscribe(() => bump()), [status]);

  if (status.getStatus() === "ok") return null;

  return (
    <div
      data-testid="autosave-quota-banner"
      role="alert"
      style={{
        ...panelStyle,
        position: "absolute",
        top: 120,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        width: "auto",
        height: "auto",
        maxWidth: "min(560px, calc(100% - 32px))",
        borderColor: "var(--dd-danger, #c0392b)",
        fontFamily: chromeFontFamily,
        fontSize: 13,
        zIndex: Z_LAYER.dialog,
      }}
    >
      <span style={{ display: "inline-flex", flex: "none", color: "var(--dd-danger, #c0392b)" }}>
        <Icon name="alert" size={14} />
      </span>
      <span>{t("autosave.quotaExceeded")}</span>
      <button type="button" data-testid="autosave-quota-save" style={{ ...buttonStyle(false), flex: "none", width: "auto", padding: "6px 10px" }} onClick={onSave}>
        {t("autosave.saveToFile")}
      </button>
    </div>
  );
}
