/**
 * What a first-time visitor sees instead of a blank white page: a short prompt in the middle of the
 * canvas naming the two or three things that are not discoverable by looking at the toolbar. It clears
 * itself the moment the drawing has anything in it — there is nothing to dismiss, and no preference to
 * remember, because an empty canvas is exactly when the prompt is wanted and never otherwise.
 *
 * Purely informational: `pointer-events: none`, so a drag that starts on top of it still draws.
 */
import { chromeFontFamily } from "./chrome-styles";
import { useTranslation } from "../i18n/use-translation";
import { useSceneVersion } from "../runtime/use-live-version";
import { useEditSessionStatus } from "../runtime/use-edit-session-status";
import type { TextEditSession } from "@deviva-draw/engine";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface EmptyStateOverlayProps {
  runtime: DevivaRuntime;
  /** Typing the very first text element leaves the scene empty until it commits — the prompt has to step aside for the caret rather than sit behind it. */
  editSession: TextEditSession | null;
}

export function EmptyStateOverlay(props: EmptyStateOverlayProps) {
  const { runtime, editSession } = props;
  const { t } = useTranslation();
  useSceneVersion(runtime.scene);
  const editing = useEditSessionStatus(editSession) === "editing";

  const isEmpty = runtime.scene.getElements().every((element) => element.isDeleted);
  if (!isEmpty || editing) return null;

  return (
    <div
      data-testid="empty-state"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        maxWidth: "min(80vw, 420px)",
        textAlign: "center",
        fontFamily: chromeFontFamily,
        color: "var(--dd-text-secondary)",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <p style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--dd-text-primary)" }}>{t("onboarding.title")}</p>
      <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.7 }}>
        {t("onboarding.text")}
        <br />
        {t("onboarding.drop")}
      </p>
    </div>
  );
}
