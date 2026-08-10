/**
 * The `requestAnimationFrame` render loop: repaints the static layer (elements) and interactive
 * layer (selection outline/handles/marquee/snap guides) every frame. Split out of
 * `use-deviva-runtime.ts` purely to keep that hook under the house line-count limit — not unit
 * tested, same DOM-only (`requestAnimationFrame`/`CanvasStage`) trade-off `canvas-stage.ts` itself
 * documents in `@deviva-draw/engine`.
 */
import type { AnyElement, CanvasStage, LaserTrailPoint, Point, RemoteCursorOverlay, Scene, SelectionState } from "@deviva-draw/engine";
import type { CameraStore } from "./camera-store";

export interface RenderLoopDeps {
  stage: CanvasStage;
  scene: Scene;
  cameraStore: CameraStore;
  selection: SelectionState;
  getMarqueeRect(): { x: number; y: number; width: number; height: number } | null;
  getSnapGuides(): readonly { orientation: "horizontal" | "vertical"; position: number; from: number; to: number }[];
  grid: { enabled: boolean; size: number };
  /** Live collaborator cursors for the interactive layer — omitted when collaboration isn't wired up (see `use-collab-session.ts`'s opt-in doc), same "getter, not a value, so a rebuilt-only-on-scene-swap loop still reads the latest" contract as `getMarqueeRect`/`getSnapGuides`. */
  getRemoteCursors?(): readonly RemoteCursorOverlay[];
  /** The element/text of the open text-edit session (or `null`), so the static layer paints the live draft on the canvas instead of the editing `<textarea>` doing it — the canvas is the sole glyph renderer, which is what makes text not shift between editing and commit. Same getter contract as the others. */
  getTextDraft(): { elementId: string; text: string } | null;
  /** Ids the eraser is previewing-to-delete this swipe — the static layer dims them as a live preview. Empty when the eraser isn't mid-swipe. Same getter contract as the others. */
  getPendingEraseIds(): ReadonlySet<string>;
  /** The laser pointer's live fading trail (scene space) — drawn on the interactive layer each frame; empty when idle. Same getter contract as the others. */
  getLaserTrail(): readonly LaserTrailPoint[];
  /** The lasso tool's in-progress free-form loop (scene space) — drawn on the interactive layer each frame; empty when idle. Same getter contract as the others. */
  getLassoPath(): readonly Point[];
}

/** Starts the loop; returns a stop function for the owning effect's cleanup. */
export function startRenderLoop(deps: RenderLoopDeps): () => void {
  const { stage, scene, cameraStore, selection, getMarqueeRect, getSnapGuides, grid, getRemoteCursors, getTextDraft, getPendingEraseIds, getLaserTrail, getLassoPath } = deps;
  let frameHandle = requestAnimationFrame(function renderFrame() {
    const camera = cameraStore.getCamera();
    const textDraft = getTextDraft();
    const pendingEraseIds = getPendingEraseIds();
    stage.staticLayer.render(scene, camera, grid, textDraft, pendingEraseIds);
    // While a text-edit session is open, hide the selection frame/handles entirely — text editing is a
    // focused mode (just the glyphs + caret + the textarea's own selection highlight), the same clean
    // look Excalidraw/tldraw show; the bounding box + resize/rotate handles would otherwise sit on top
    // of the text being typed. The selection *state* is untouched, so the handles return on commit.
    const selectedElements = textDraft
      ? []
      : [...selection.getSelectedIds()].map((id) => scene.getElement(id)).filter((element): element is AnyElement => !!element);
    stage.interactiveLayer.render(
      { selectedElements, marqueeRect: getMarqueeRect(), snapGuides: getSnapGuides(), remoteCursors: getRemoteCursors?.() ?? [], laserTrail: getLaserTrail(), lassoPath: getLassoPath() },
      camera,
    );
    frameHandle = requestAnimationFrame(renderFrame);
  });
  return () => cancelAnimationFrame(frameHandle);
}
