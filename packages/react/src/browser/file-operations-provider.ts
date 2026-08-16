/**
 * The injectable file-operations seam for hosts with real filesystems (the desktop shell): scene
 * open/save route through a `FileOperationsProvider` so a host can supply path-based operations —
 * native dialogs, save-in-place, external-change watching — without this package importing any
 * host API (`@tauri-apps/*` must never appear under `packages/`). The browser default wraps the
 * existing picker/download adapters so provider-driven logic behaves exactly like today's web app.
 */
import { pickAndReadFileEntry, saveFile } from "./persistence-adapters";

/** A picked file's identity and content. `path` is `null` in path-less hosts (the browser): the file has no stable identity, so save-in-place degrades to save-as. */
export interface OpenedFile {
  path: string | null;
  name: string;
  text: string;
}

export interface FileOperationsProvider {
  /** System open dialog filtered to `extensions` (dot-prefixed, e.g. `[".devivadraw"]`); `null` on cancel or unreadable pick. */
  pickFile(extensions: string[]): Promise<OpenedFile | null>;
  /**
   * Save-in-place at `path` — a value previously produced by `pickFile`/`pickSavePath`, opaque to the
   * caller (the browser default hands out virtual name-only "paths"). MUST be atomic where paths are
   * real (temp + rename). Rejects on failure — the caller owns the error UX.
   */
  writeFile(path: string, text: string): Promise<void>;
  /** Save-As dialog; resolves the chosen path (`null` on cancel). Path-less hosts return `suggestedName` as a virtual path for the matching `writeFile`. */
  pickSavePath(suggestedName: string, extensions: string[]): Promise<string | null>;
  /** Watch a real path for external changes; fires `"modified"` and `"removed"` (delete/rename). Returns an unsubscribe. Absent in path-less hosts. */
  watchFile?(path: string, onEvent: (kind: "modified" | "removed") => void): () => void;
}

const SCENE_MIME_TYPE = "application/json";

/**
 * Path-less browser default: `pickFile` via the existing picker adapters (`path: null` — no stable
 * identity), and save via the existing File System Access API/download fallback. `pickSavePath`
 * hands back `suggestedName` as a virtual path so the pick→write pair still composes; `writeFile`
 * then treats its `path` as the suggested filename. `watchFile` is absent — nothing to watch.
 */
export function createBrowserFileOperations(): FileOperationsProvider {
  return {
    async pickFile(extensions) {
      const entry = await pickAndReadFileEntry(extensions.join(","));
      if (entry === null) return null;
      return { path: null, name: entry.name, text: entry.text };
    },
    writeFile: (path, text) => saveFile(path, text, SCENE_MIME_TYPE),
    pickSavePath: (suggestedName) => Promise.resolve(suggestedName),
  };
}
