/**
 * A small contextual hint under the toolbar that reflects the active tool ("Drag to draw a
 * rectangle.", "Drag for a straight line, or click to add points.", …) — the same affordance
 * discoverability Excalidraw's top hint gives, driven off `ToolStateMachine` (reactive, not polled).
 * Purely informational: `pointer-events: none` so it never intercepts a canvas gesture.
 */
import { chromeFontFamily } from "./chrome-styles";
import { useTranslation } from "../i18n/use-translation";
import { useToolVersion } from "../runtime/use-live-version";
import type { TranslationKey } from "../i18n/catalog-en";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface CanvasHintProps {
  runtime: DevivaRuntime;
}

export function CanvasHint(props: CanvasHintProps) {
  const { runtime } = props;
  const { t } = useTranslation();
  useToolVersion(runtime.toolStateMachine);
  const tool = runtime.toolStateMachine.getActiveToolName();

  return (
    <div
      data-testid="canvas-hint"
      style={{
        position: "absolute",
        top: 62,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "min(90vw, 640px)",
        textAlign: "center",
        fontFamily: chromeFontFamily,
        fontSize: 12,
        color: "var(--dd-text-secondary)",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {t(`hint.${tool}` as TranslationKey)}
    </div>
  );
}
