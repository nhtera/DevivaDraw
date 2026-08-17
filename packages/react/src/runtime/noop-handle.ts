/**
 * Safe fallback `DevivaDrawHandle` for the brief window before the canvas has mounted (or if a host
 * calls a ref method before `useEffect` has run) — every method is a harmless no-op/empty read rather
 * than `undefined`, so `ref.current.getSceneElements()` never has to be null-checked by the caller.
 */
import { Scene } from "@deviva-draw/engine";
import type { DevivaDrawHandle } from "./imperative-handle";

export const NOOP_HANDLE: DevivaDrawHandle = {
  getSceneElements: () => [],
  getFiles: () => ({}),
  exportToPng: () => Promise.reject(new Error("deviva-draw: not mounted yet")),
  exportToSvg: () => "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"0\" height=\"0\"></svg>",
  resetScene: () => {},
  loadSceneDocument: () => false,
  undo: () => {},
  redo: () => {},
  zoomToFit: () => {},
  runAction: () => false,
  openDocument: () => false, // options ignored — nothing mounted to preserve a camera for

  saveDocument: () => Promise.resolve("canceled" as const),
  // An empty document, not a throw: a host snapshotting before mount should get "nothing was on the
  // board", which is the truth, rather than an error it has to handle.
  getDocument: () => new Scene().toJSON(),
};
