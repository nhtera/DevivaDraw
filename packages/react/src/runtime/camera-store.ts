/**
 * The camera-change subscription mechanism: `Camera` (`@deviva-draw/engine`)
 * is plain data with no pub-sub of its own — every consumer that needs to react to a pan/zoom
 * (the text-editor overlay's position while editing during a live pan, the top bar's zoom-percentage
 * readout) previously had no way to do that except recomputing on every React render and hoping
 * something else happened to trigger one, or polling on a timer. `createCameraStore` wraps
 * `getCamera`/`setCamera` with a synchronous notify-on-actual-change signal instead: every mutation
 * path (`PanZoomTool`, the selection tool's pan, wheel/keyboard, the touch-gesture adapter) already
 * goes through `setCamera`, so wiring this store in as the single `getCamera`/`setCamera` pair the
 * whole runtime shares makes every camera consumer reactive for free, with zero polling and zero
 * per-frame diffing.
 */
import type { Camera } from "@deviva-draw/engine";

export type CameraChangeListener = () => void;

export interface CameraStore {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  /** Registers a listener fired whenever `setCamera` actually changes `scrollX`/`scrollY`/`zoom`; returns an unsubscribe function. */
  subscribe(listener: CameraChangeListener): () => void;
}

export function createCameraStore(initial: Camera): CameraStore {
  let camera = initial;
  const listeners = new Set<CameraChangeListener>();

  return {
    getCamera: () => camera,
    setCamera: (next) => {
      if (next.scrollX === camera.scrollX && next.scrollY === camera.scrollY && next.zoom === camera.zoom) return;
      camera = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
