/**
 * "The stored library changed" notification. `library-storage.ts` is a plain localStorage module, so a
 * mounted `LibraryPanel` — which reads the shelf into React state once, on mount — has no way to learn
 * that something else wrote to it. Anything that writes the library from outside the panel (a dropped
 * `.excalidrawlib`, the context menu's "Add to library") announces it here and the panel re-reads.
 *
 * A window `CustomEvent` rather than a React context: the writers are DOM-event handlers and plain
 * functions living outside the component tree, and the same decoupling the embed overlay's
 * `deviva:embed-activate` signal uses applies here.
 */
export const LIBRARY_CHANGED_EVENT = "deviva:library-changed";

export function notifyLibraryChanged(): void {
  window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED_EVENT));
}

/** Subscribes to library writes; returns the unsubscribe for the caller's effect cleanup. */
export function onLibraryChanged(listener: () => void): () => void {
  window.addEventListener(LIBRARY_CHANGED_EVENT, listener);
  return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, listener);
}
