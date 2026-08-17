/**
 * Small reactive "re-render when X changes" hooks over the engine's own subscribe-based stores
 * (`Scene`, `SelectionState`, `ToolStateMachine` — all plain pub-sub, see each's own module doc) —
 * every chrome component that needs to reflect live engine state (selection count, active tool,
 * undo/redo availability) uses one of these instead of polling on a timer, the same real-subscription
 * approach `camera-store.ts` uses for camera changes and `text-editor-overlay.tsx`'s position
 * tracking relies on.
 *
 * Not unit tested: exercising a React hook's render/effect cycle needs `@testing-library/react`
 * (not a dependency of this package — see `package.json`), the same DOM-testing-infra trade-off
 * every other hook in this package documents. The subscribe/unsubscribe primitives it wraps
 * (`Scene.subscribe`, `SelectionState.subscribe`, `ToolStateMachine.subscribe`) are already fully
 * unit tested in `@deviva-draw/engine`.
 */
import { useEffect, useReducer } from "react";
import type { Scene, SelectionState, ToolStateMachine } from "@deviva-draw/engine";
import type { CameraStore } from "./camera-store";

/** Bumps on every scene mutation — covers element add/update/delete, undo/redo (`loadElementsSnapshot` notifies too), and file changes. */
export function useSceneVersion(scene: Scene): number {
  const [version, dispatch] = useReducer((count: number) => count + 1, 0);
  useEffect(() => scene.subscribe(() => dispatch()), [scene]);
  return version;
}

/** Live document-level canvas background color (or `null` for the theme default). Null-tolerant so the shell can call it before the runtime/scene exists. */
export function useCanvasBackground(scene: Scene | null): string | null {
  const [, dispatch] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!scene) return;
    return scene.subscribe(() => dispatch());
  }, [scene]);
  return scene?.getBackground() ?? null;
}

/** Bumps whenever the selected id set changes. */
export function useSelectionVersion(selection: SelectionState): number {
  const [version, dispatch] = useReducer((count: number) => count + 1, 0);
  useEffect(() => selection.subscribe(() => dispatch()), [selection]);
  return version;
}

/**
 * Bumps whenever the active tool actually changes (not on a no-op re-selection).
 *
 * The bump on subscribe is not redundant. A subscription is established in an effect, which React
 * runs *after* the render that read the value — so a change landing in that window notifies nobody
 * and the component keeps painting a value that is already wrong, until something unrelated happens
 * to change the tool again. Leaving presentation does exactly that: the toolbar is remounting as the
 * previous tool is put back, so it rendered with the laser still active and showed no tool selected
 * while a creation tool was live under it.
 */
export function useToolVersion(toolStateMachine: ToolStateMachine): number {
  const [version, dispatch] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    dispatch();
    return toolStateMachine.subscribe(() => dispatch());
  }, [toolStateMachine]);
  return version;
}

/** Bumps whenever the camera's scroll/zoom actually changes — see `camera-store.ts`'s module doc for why this is a real subscription rather than a poll. */
export function useCameraVersion(cameraStore: CameraStore): number {
  const [version, dispatch] = useReducer((count: number) => count + 1, 0);
  useEffect(() => cameraStore.subscribe(() => dispatch()), [cameraStore]);
  return version;
}
