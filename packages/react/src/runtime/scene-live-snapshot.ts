/**
 * Pure "live (non-deleted) elements + their still-referenced files" readers over a `Scene` — the
 * exact snapshot shape both `imperative-handle.ts`'s `getSceneElements`/`getFiles` and
 * `use-deviva-runtime.ts`'s debounced `onChange` payload need, factored out once so the two never
 * drift (previously duplicated inline in both places).
 */
import type { AnyElement, Scene } from "@deviva-draw/engine";

export interface LiveStoredFile {
  mimeType: string;
  dataURL: string;
  createdAt: number;
}

/** Every non-deleted element, in z-order. */
export function getLiveElements(scene: Scene): AnyElement[] {
  return scene.getElements().filter((element) => !element.isDeleted);
}

/** Every stored file still referenced by a live (non-deleted) image element. */
export function getLiveFiles(scene: Scene): Record<string, LiveStoredFile> {
  const files: Record<string, LiveStoredFile> = {};
  for (const element of scene.getElements()) {
    if (element.isDeleted || element.type !== "image") continue;
    const file = scene.getFile(element.fileId);
    if (file) files[element.fileId] = file;
  }
  return files;
}
