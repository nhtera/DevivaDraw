/**
 * Reads an `.excalidraw` scene file. The sibling of `excalidraw-library-import.ts` — same element
 * translation underneath, different wrapper: a scene is one flat element array plus an `appState` and
 * a `files` sidecar, where a library is a list of element arrays and no sidecar at all.
 *
 * That sidecar is the reason images import here and not there. `files` maps each `fileId` to the
 * image's own `dataURL`, which is exactly the shape `Scene`'s file store holds, so an `ImageElement`
 * arrives with its bytes. A library item has nowhere to carry them, so the same element is correctly
 * skipped on that path — see `ImportExcalidrawElementsOptions.availableFileIds`.
 *
 * Returns the *parts* of a scene rather than a built `Scene`: the caller decides whether it is opening
 * a new document or merging into a live one, and only it knows which.
 */
import type { AnyElement } from "../elements/element-types";
import type { StoredFile } from "../scene/scene-files-store";
import { importExcalidrawElements } from "./excalidraw-element-import";
import { isRecord, num, str } from "./excalidraw-schema";

export const EXCALIDRAW_SCENE_FILE_TYPE = "excalidraw";

export interface ExcalidrawSceneImport {
  elements: AnyElement[];
  /** `fileId` → image bytes, ready for `Scene.restoreFile`. Empty when the file carried no images. */
  files: Map<string, StoredFile>;
  /** `appState.viewBackgroundColor`, or `null` to fall back to the theme default. */
  background: string | null;
  /** Source element types with no equivalent here, and how many were dropped. */
  skipped: Record<string, number>;
}

/**
 * Excalidraw's `files` entries carry more than this app stores (`id`, `lastRetrieved`); only the
 * three fields the file store actually holds are kept. An entry without a `dataURL` is unusable — the
 * bytes *are* the data URL — so it is dropped, which in turn makes its `image` element skip too
 * rather than render as a permanently-broken box.
 */
function filesOf(raw: unknown): Map<string, StoredFile> {
  const files = new Map<string, StoredFile>();
  if (!isRecord(raw)) return files;
  for (const [fileId, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || typeof entry.dataURL !== "string" || entry.dataURL === "") continue;
    files.set(fileId, { mimeType: str(entry.mimeType, "image/png"), dataURL: entry.dataURL, createdAt: num(entry.created, 0) });
  }
  return files;
}

/**
 * Parsed JSON → scene parts, or `null` when `raw` is not an Excalidraw scene — which the caller must
 * tell apart from a scene that is legitimately empty, so it can report "wrong file" instead of
 * silently opening a blank document over the user's work.
 */
export function importExcalidrawScene(raw: unknown): ExcalidrawSceneImport | null {
  if (!isRecord(raw) || raw.type !== EXCALIDRAW_SCENE_FILE_TYPE || !Array.isArray(raw.elements)) return null;

  const files = filesOf(raw.files);
  const { elements, skipped } = importExcalidrawElements(raw.elements, { availableFileIds: new Set(files.keys()) });
  const appState = isRecord(raw.appState) ? raw.appState : {};
  const background = typeof appState.viewBackgroundColor === "string" ? appState.viewBackgroundColor : null;

  // Drop bytes no surviving element references, so opening a file with a skipped image does not carry
  // its payload along invisibly.
  const referenced = new Set(elements.filter((element) => element.type === "image").map((element) => element.fileId));
  for (const fileId of [...files.keys()]) {
    if (!referenced.has(fileId)) files.delete(fileId);
  }

  return { elements, files, background, skipped };
}
