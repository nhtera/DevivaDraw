/**
 * Double-click-to-edit: a native browser `dblclick` (not the engine's gesture pipeline — double-click
 * detection isn't a pointer-gesture concern) hit-tests a bindable container first, then an arrow's
 * path, opening/resuming a bound label for whichever it found; on a miss (empty canvas) it places a new
 * standalone text element at the point, the "double-click anywhere to add text" affordance mainstream
 * whiteboards have. Only armed while the select tool is active, so it never fights the shape/arrow/text
 * tools' own click handling.
 */
import { screenToScene, startArrowLabelEdit, startBoundTextEdit, startExistingStandaloneTextEdit, startStandaloneTextEdit } from "@deviva-draw/engine";
import type { Camera, Scene, ShapeStyleState, TextEditSession, TextMeasurer, ToolStateMachine } from "@deviva-draw/engine";
import { findArrowAt } from "../browser/find-arrow-at-point";
import { findBindableContainerAt } from "../browser/find-bindable-container-at-point";
import { findStandaloneTextAt } from "../browser/find-standalone-text-at-point";

export interface DoubleClickEditOptions {
  container: HTMLElement;
  scene: Scene;
  toolStateMachine: ToolStateMachine;
  selectToolName: string;
  editSession: TextEditSession;
  textMeasurer: TextMeasurer;
  getCamera: () => Camera;
  /** Supplies the stroke/opacity for a text element created by double-clicking empty canvas (matches the text tool's own "next shape" defaults). */
  styleState: ShapeStyleState;
}

/** Attaches the listener; returns a detach function for the owning effect's cleanup. */
export function attachDoubleClickToEditListener(options: DoubleClickEditOptions): () => void {
  const { container, scene, toolStateMachine, selectToolName, editSession, textMeasurer, getCamera, styleState } = options;

  const handleDoubleClick = (event: MouseEvent) => {
    if (toolStateMachine.getActiveToolName() !== selectToolName) return;
    const rect = container.getBoundingClientRect();
    const scenePoint = screenToScene({ x: event.clientX - rect.left, y: event.clientY - rect.top }, getCamera());

    const containerHit = findBindableContainerAt(scene, scenePoint);
    if (containerHit) {
      startBoundTextEdit(scene, editSession, containerHit.id, textMeasurer);
      return;
    }
    const arrowHit = findArrowAt(scene, scenePoint);
    if (arrowHit) {
      startArrowLabelEdit(scene, editSession, arrowHit.id, textMeasurer);
      return;
    }
    // Existing standalone text under the cursor: re-open *it* for editing (not a duplicate at the click
    // point) — the double-click-to-edit-your-own-text affordance, and the fix for the "text jumps to a
    // new offset box on edit" bug this hit test would otherwise fall through into below.
    const textHit = findStandaloneTextAt(scene, scenePoint);
    if (textHit) {
      startExistingStandaloneTextEdit(scene, editSession, textMeasurer, textHit.id);
      return;
    }
    // Empty canvas: place a new standalone text element right where the user double-clicked.
    const style = styleState.getStyle();
    startStandaloneTextEdit(scene, editSession, textMeasurer, scenePoint, { strokeColor: style.strokeColor, opacity: style.opacity });
  };

  container.addEventListener("dblclick", handleDoubleClick);
  return () => container.removeEventListener("dblclick", handleDoubleClick);
}
