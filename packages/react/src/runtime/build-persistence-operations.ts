/**
 * Concrete `PersistenceOperations` implementation backing the file/export actions
 * (`actions/file-actions.ts`) — wires `browser/scene-file-operations.ts`'s browser adapters to the
 * live scene. "Open" and "New scene" both need to replace *which* `Scene` instance the whole runtime
 * is built around (not just mutate the current one), so both go through `onSceneReplaced`, the same
 * "rebuild the runtime" path `use-deviva-runtime.ts`'s `sceneVersion` bump drives.
 */
import type { AnyElement, HistoryStack, MultiPageDocumentV1, Scene, SelectionState } from "@deviva-draw/engine";
import type { PersistenceOperations, SaveDocumentOutcome } from "../actions/action-types";
import {
  exportSceneToPngFile,
  exportSceneToSvgFile,
  openDocumentFromFile,
  openDocumentViaProvider,
  openSceneFromFile,
  saveDocumentToFile,
  saveDocumentViaProvider,
  saveSceneToFile,
  copySceneImageToClipboard,
  copySceneSvgToClipboard,
} from "../browser/scene-file-operations";
import type { OpenedDocument } from "../browser/scene-file-operations";
import type { FileOperationsProvider } from "../browser/file-operations-provider";
import { createShareLink } from "../browser/share-link-client";
import { resetScene } from "./reset-scene";

const EXPORT_PNG_DEFAULT_SCALE = 1;

/** Optional pages-awareness: when present, "Open"/"Save" operate on the whole multi-page document instead of the single live scene. Exports and "Reset canvas" stay scoped to the active page either way. */
export interface PagesPersistenceAdapter {
  getDocument(): MultiPageDocumentV1;
  replaceDocument(document: OpenedDocument): void;
}

export interface BuildPersistenceOperationsDeps {
  getScene(): Scene;
  history: HistoryStack<AnyElement[]>;
  selection: SelectionState;
  /** Called when "Open" successfully loads a different `Scene` instance — the caller swaps its live reference and rebuilds the runtime around it. */
  onSceneReplaced(scene: Scene): void;
  pages?: PagesPersistenceAdapter;
  onError?(error: unknown): void;
  /** The collab-server's base URL — omitted (e.g. the host app never configured `<DevivaDraw shareApiBaseUrl/>`) makes `shareScene` reject immediately rather than attempting a request to nowhere. */
  shareApiBaseUrl?: string;
  /**
   * Host-supplied file operations (the desktop shell's path-based dialogs/writes). ABSENT ⇒ every
   * open/save flow below stays on the exact pre-seam browser code paths — web behavior is unchanged
   * by construction, not by wrapper equivalence.
   */
  fileOperations?: FileOperationsProvider;
  /** The document's current save-in-place identity, provider mode only — `null` until an open/save established one. The identity's storage (and dirty tracking) is the document-lifecycle phase's job; this phase only surfaces it. */
  getFilePath?(): string | null;
  /** Fired when a provider-based open/save establishes (or re-establishes) the document's file identity. */
  onFileIdentity?(identity: { path: string | null; name: string }): void;
  /**
   * Resolves once image payloads held outside the document (see `restore-document-files.ts`) have
   * been read back into the scene. Every operation below that turns the scene into bytes waits on it:
   * a document restored from storage carries `fileId` references before it carries the images
   * themselves, and a save or export that ran in that window would quietly produce a file with blank
   * images in it. Absent ⇒ nothing to wait for (a host managing its own data, or no file store).
   */
  whenFilesReady?(): Promise<void>;
}

export function buildPersistenceOperations(deps: BuildPersistenceOperationsDeps): PersistenceOperations {
  const { getScene, history, selection, onSceneReplaced, pages, onError, shareApiBaseUrl, fileOperations, getFilePath, onFileIdentity, whenFilesReady } = deps;
  const reportError = onError ?? ((error: unknown) => console.error("deviva-draw: persistence operation failed", error));

  /** The "don't serialize a half-loaded document" gate — see `whenFilesReady`. Resolved already in the overwhelming majority of calls; it costs a microtask. */
  const ready = (): Promise<void> => whenFilesReady?.() ?? Promise.resolve();

  /** Strips the directory part of a real path for display — a provider path is host-native (`/` or `\`). */
  const fileNameOf = (path: string) => path.split(/[/\\]/).pop() ?? path;

  /** The provider save flow with its outcome surfaced — `saveScene` wraps it fire-and-forget; the desktop shell calls it directly (error dialog, Save-As fallback, quit guard). */
  const saveSceneOutcome = async (options?: { saveAs?: boolean }): Promise<SaveDocumentOutcome> => {
    await ready();
    if (!fileOperations) {
      // Browser hosts have no path identity to surface, but failures still must not escape as
      // unhandled rejections — the File System Access picker throws on cancel and write errors.
      try {
        await (pages ? saveDocumentToFile(pages.getDocument()) : saveSceneToFile(getScene()));
        return "saved";
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
    try {
      const document = pages ? pages.getDocument() : getScene().toJSON();
      const currentPath = options?.saveAs ? null : (getFilePath?.() ?? null);
      const path = await saveDocumentViaProvider(fileOperations, document, currentPath);
      if (path === null) return "canceled";
      onFileIdentity?.({ path, name: fileNameOf(path) });
      return "saved";
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    saveSceneOutcome,
    whenFilesReady: ready,
    newScene: () => resetScene(getScene(), history, selection),
    openScene: async () => {
      try {
        if (fileOperations) {
          const opened = await openDocumentViaProvider(fileOperations);
          if (!opened) return;
          if (pages) pages.replaceDocument(opened.document);
          else {
            // Single-scene host: a multi-page file collapses to its first page, same as the
            // imperative `loadScene` rule.
            const scene = opened.document.pages[0]?.scene;
            if (scene) onSceneReplaced(scene);
          }
          onFileIdentity?.({ path: opened.path, name: opened.name });
          return;
        }
        if (pages) {
          const opened = await openDocumentFromFile();
          if (opened) pages.replaceDocument(opened);
          return;
        }
        const opened = await openSceneFromFile();
        if (opened) onSceneReplaced(opened);
      } catch (error) {
        reportError(error);
      }
    },
    loadScene: (scene) => onSceneReplaced(scene),
    saveScene: async () => {
      const outcome = await saveSceneOutcome();
      if (typeof outcome === "object") reportError(new Error(outcome.error));
    },
    exportPng: () =>
      ready()
        .then(() => exportSceneToPngFile(getScene(), EXPORT_PNG_DEFAULT_SCALE))
        .catch(reportError),
    exportSvg: () =>
      ready()
        .then(() => exportSceneToSvgFile(getScene()))
        .catch(reportError),
    copyAsImage: () =>
      ready()
        .then(() => copySceneImageToClipboard(getScene()))
        .catch(reportError),
    copyAsSvg: () =>
      ready()
        .then(() => copySceneSvgToClipboard(getScene()))
        .catch(reportError),
    // Deliberately not `.catch(reportError)`-wrapped like every operation above — see
    // `PersistenceOperations.shareScene`'s doc: the caller (`actions/share-actions.ts`) needs the
    // thrown error to populate `ShareDialogState`'s "error" branch, not just a console log.
    shareScene: (options) => {
      if (!shareApiBaseUrl) return Promise.reject(new Error("deviva-draw: share link service is not configured (missing shareApiBaseUrl)"));
      return ready().then(() =>
        createShareLink({ apiBaseUrl: shareApiBaseUrl, origin: window.location.origin, document: pages ? pages.getDocument() : getScene().toJSON(), expiresAt: options?.expiresAt }),
      );
    },
  };
}
