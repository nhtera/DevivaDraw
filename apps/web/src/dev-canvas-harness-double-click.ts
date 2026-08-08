/**
 * Double-click-to-edit a bound label: a native browser `dblclick` (not the engine's gesture
 * pipeline — double-click detection isn't a pointer-gesture concern) hit-tests a bindable container
 * first, then an arrow's path, and opens/resumes editing whichever it found. Only armed while the
 * select tool is active, so it never fights the shape/arrow/text tools' own click handling. Split
 * out of `dev-canvas-harness-runtime.ts` purely to keep that file under the house line-count limit.
 */
import { screenToScene, startArrowLabelEdit, startBoundTextEdit } from "@deviva-draw/engine";
import type { Camera, Scene, TextEditSession, TextMeasurer, ToolStateMachine } from "@deviva-draw/engine";
import { findArrowAt } from "./find-arrow-at-point";
import { findBindableContainerAt } from "./find-bindable-container-at-point";

export interface DoubleClickEditOptions {
  container: HTMLElement;
  scene: Scene;
  toolStateMachine: ToolStateMachine;
  selectToolName: string;
  editSession: TextEditSession;
  textMeasurer: TextMeasurer;
  getCamera: () => Camera;
}

/** Attaches the listener; returns a detach function for the owning effect's cleanup. */
export function attachDoubleClickToEditListener(options: DoubleClickEditOptions): () => void {
  const { container, scene, toolStateMachine, selectToolName, editSession, textMeasurer, getCamera } = options;

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
    if (arrowHit) startArrowLabelEdit(scene, editSession, arrowHit.id, textMeasurer);
  };

  container.addEventListener("dblclick", handleDoubleClick);
  return () => container.removeEventListener("dblclick", handleDoubleClick);
}
