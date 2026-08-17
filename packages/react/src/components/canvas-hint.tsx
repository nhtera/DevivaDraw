/**
 * A small contextual hint under the toolbar reflecting what you can do *right now* — the active tool
 * ("Drag to draw a rectangle."), what to do with a selection once you have one, and how to finish a
 * text you are typing. The same affordance discoverability Excalidraw's top hint gives, driven off
 * `ToolStateMachine`/`SelectionState`/`TextEditSession` (reactive, not polled); which of the three
 * wins is decided by `canvas-hint-key.ts`.
 *
 * Purely informational: `pointer-events: none` so it never intercepts a canvas gesture.
 */
import { chromeFontFamily } from "./chrome-styles";
import { canvasHintKey } from "./canvas-hint-key";
import { useTranslation } from "../i18n/use-translation";
import { useSelectionVersion, useToolVersion } from "../runtime/use-live-version";
import { useEditSessionStatus } from "../runtime/use-edit-session-status";
import type { TextEditSession } from "@deviva-draw/engine";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface CanvasHintProps {
  runtime: DevivaRuntime;
  editSession: TextEditSession | null;
}

/** Whether the selection is exactly one arrow — the case with its own editing affordances (endpoint handles, not resize handles). */
function isSingleArrowSelected(runtime: CanvasHintProps["runtime"]): boolean {
  if (runtime.selection.size !== 1) return false;
  const [id] = runtime.selection.getSelectedIds();
  return id !== undefined && runtime.scene.getElement(id)?.type === "arrow";
}

export function CanvasHint(props: CanvasHintProps) {
  const { runtime, editSession } = props;
  const { t } = useTranslation();
  useToolVersion(runtime.toolStateMachine);
  useSelectionVersion(runtime.selection);
  const isEditingText = useEditSessionStatus(editSession) === "editing";

  const key = canvasHintKey({
    tool: runtime.toolStateMachine.getActiveToolName(),
    hasSelection: runtime.selection.size > 0,
    isEditingText,
    hasSingleArrowSelected: isSingleArrowSelected(runtime),
  });
  if (!key) return null;

  return (
    <div
      data-testid="canvas-hint"
      style={{
        position: "absolute",
        // Sits just under the top toolbar. Var-driven so the touch-density stylesheet can push it
        // down when the tablet tier's 44px targets make that toolbar taller (see chrome-stylesheet.ts).
        top: "var(--dd-hint-top, 62px)",
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
      {t(key)}
    </div>
  );
}
