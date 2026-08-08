/**
 * The `requestAnimationFrame` render loop: repaints the static layer (elements) and interactive
 * layer (selection outline/handles/marquee/snap guides) every frame. Split out of
 * `use-deviva-runtime.ts` purely to keep that hook under the house line-count limit — not unit
 * tested, same DOM-only (`requestAnimationFrame`/`CanvasStage`) trade-off `canvas-stage.ts` itself
 * documents in `@deviva-draw/engine`.
 */
import type { AnyElement, CanvasStage, Scene, SelectionState } from "@deviva-draw/engine";
import type { CameraStore } from "./camera-store";

export interface RenderLoopDeps {
  stage: CanvasStage;
  scene: Scene;
  cameraStore: CameraStore;
  selection: SelectionState;
  getMarqueeRect(): { x: number; y: number; width: number; height: number } | null;
  getSnapGuides(): readonly { orientation: "horizontal" | "vertical"; position: number; from: number; to: number }[];
  grid: { enabled: boolean; size: number };
}

/** Starts the loop; returns a stop function for the owning effect's cleanup. */
export function startRenderLoop(deps: RenderLoopDeps): () => void {
  const { stage, scene, cameraStore, selection, getMarqueeRect, getSnapGuides, grid } = deps;
  let frameHandle = requestAnimationFrame(function renderFrame() {
    const camera = cameraStore.getCamera();
    stage.staticLayer.render(scene, camera, grid);
    const selectedElements = [...selection.getSelectedIds()]
      .map((id) => scene.getElement(id))
      .filter((element): element is AnyElement => !!element);
    stage.interactiveLayer.render({ selectedElements, marqueeRect: getMarqueeRect(), snapGuides: getSnapGuides() }, camera);
    frameHandle = requestAnimationFrame(renderFrame);
  });
  return () => cancelAnimationFrame(frameHandle);
}
