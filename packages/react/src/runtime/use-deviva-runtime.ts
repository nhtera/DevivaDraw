/**
 * The composed app shell's mount effect: builds `CanvasStage` + the full `DevivaRuntime` (tools,
 * pipeline, action registry) around whichever `Scene` instance is currently live, starts the render
 * loop, wires autosave (only when the host didn't supply `initialData` — an embedder managing its own
 * persistence shouldn't have this component silently writing to `window.localStorage` under it), and
 * exposes the imperative handle + a debounced `onChange` notification. Mirrors the earlier
 * development harness's mount effect, generalized into a reusable hook `deviva-draw-app.tsx` calls.
 *
 * This effect only reruns on an explicit scene swap (`sceneVersion`), not on every render — so
 * `onChange`, `getThemeMode`/`toggleThemeMode`, and `isChromeOverlayOpen` are all read through
 * `useStableCallback`/`useStableGetter` (or the caller's own stable wrapper) rather than closed over
 * directly: a plain closure would freeze at whatever it was when the effect last ran, silently
 * calling a stale `onChange` forever after the host passes a new (non-memoized) one on a later
 * render. `getThemeMode`/`toggleThemeMode`/`isChromeOverlayOpen` are the caller's responsibility to
 * stabilize (see `deviva-draw-shell.tsx`); `onChange` is stabilized internally here since it's this
 * hook's own parameter, not forwarded from another already-stable source.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  createBrowserImageDecoder,
  createCamera,
  createCanvasTextMeasurer,
  CanvasStage,
  generatePageId,
  ImageDecodeCache,
  loadTextFonts,
  Scene,
} from "@deviva-draw/engine";
import type { AnyElement, FileStoreLike, MultiPageDocumentV1, RemoteCursorOverlay, SceneDocument, TextEditSession } from "@deviva-draw/engine";
import type { FileOperationsProvider } from "../browser/file-operations-provider";
import { referencedFileIds } from "@deviva-draw/engine";
import { openIndexedDbFileStore } from "../browser/indexeddb-file-store";
import { openIndexedDbVersionStore } from "../browser/indexeddb-version-store";
import type { VersionStore } from "../browser/indexeddb-version-store";
import type { MilestoneReason } from "../browser/version-snapshot-types";
import { startVersionSnapshotScheduler } from "./version-snapshot-scheduler";
import type { VersionSnapshotScheduler } from "./version-snapshot-scheduler";
import { collectOrphanedFiles, expectStoredFiles, restoreDocumentFiles, restoreSceneFiles } from "./restore-document-files";
import { buildCollectionKeepSet } from "./collection-keep-set";
import { retainedFileIds } from "../browser/retained-file-ids";
import { documentFromFileText } from "../browser/scene-file-operations";
import { buildPersistenceOperations } from "./build-persistence-operations";
import { DocumentStateTracker } from "./document-state-tracker";
import type { DocumentState } from "./document-state-tracker";
import { buildRuntime } from "./build-runtime";
import type { DevivaDrawHandle } from "./imperative-handle";
import { buildImperativeHandle } from "./imperative-handle";
import { restoreBrowserAutosave, startBrowserAutosave, startBrowserDocumentAutosave } from "../browser/scene-file-operations";
import type { DocumentAutosaveController } from "../browser/scene-file-operations";
import { PageStore } from "../pages/page-store";
import { createBrowserExportRenderTarget, createRoughSvgGenerator } from "../browser/persistence-adapters";
import { getLiveElements, getLiveFiles } from "./scene-live-snapshot";
import type { LiveStoredFile } from "./scene-live-snapshot";
import { startRenderLoop } from "./start-render-loop";
import type { CameraStore } from "./camera-store";
import { createAutosaveStatusStore } from "./autosave-status-store";
import type { AutosaveStatusStore } from "./autosave-status-store";
import { useStableCallback } from "./use-stable-ref";
import type { UiToggleState } from "../actions/action-types";
import { adaptBackgroundColorForTheme, adaptStrokeColorForTheme } from "../theme/canvas-color-inversion";
import type { ThemeMode } from "../theme/theme-tokens";
import type { DevivaRuntime } from "./runtime-types";

/** Coalesces bursts of scene mutations (a drag, a multi-keystroke text edit) into one `onChange` call per quiet period, instead of one per micro-mutation. */
const ON_CHANGE_DEBOUNCE_MS = 250;

export interface UseDevivaRuntimeOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * Owned by the caller (`deviva-draw-shell.tsx`), not this hook — `useContextMenuTriggers`/
   * `usePasteAndDrop`/`TextEditorOverlay` all need the same `CameraStore` instance *before* this
   * hook's runtime exists (e.g. to compute `isChromeOverlayOpen` from the context menu's open state),
   * so the shell creates it once and hands it in here rather than reading it back out.
   */
  cameraStore: CameraStore;
  /** Multi-page documents require `pageStore` (the shell always provides one); without it only the single-scene shape is loaded — see `buildInitialScene`. */
  initialData?: SceneDocument | MultiPageDocumentV1 | null;
  /** Scopes localStorage autosave to this key — see `DevivaDrawProps.persistenceKey`'s doc. Ignored whenever `initialData` is supplied (host-managed persistence, autosave stays off). */
  persistenceKey?: string;
  onChange?(elements: AnyElement[], files: Record<string, LiveStoredFile>): void;
  ui: UiToggleState;
  /** The collab-server's base URL, forwarded to `buildPersistenceOperations` for the "Share" action — see that module's `shareApiBaseUrl` doc. */
  shareApiBaseUrl?: string;
  /** Host-supplied path-based file operations (the desktop shell) — forwarded to `buildPersistenceOperations`; absent keeps the browser open/save paths untouched. See `DevivaDrawProps.fileOperations`. */
  fileOperations?: FileOperationsProvider;
  /** Fired synchronously on every file-identity/dirty transition — see `DevivaDrawProps.onDocumentStateChange`. */
  onDocumentStateChange?(state: DocumentState): void;
  getThemeMode(): ThemeMode;
  toggleThemeMode(): void;
  /** `true` while the tool lock is engaged — see `build-runtime.ts`'s `getToolLocked` doc. */
  getToolLocked(): boolean;
  /** `true` while the command palette, shortcuts dialog, main menu, or context menu is open — suppresses the global keyboard-shortcut resolver so typing into an overlay's search input can never leak through and switch tools (see `build-runtime.ts`'s `isChromeOverlayOpen` doc). */
  isChromeOverlayOpen(): boolean;
  /** Live collaborator cursors for the interactive layer — see `start-render-loop.ts`'s `RenderLoopDeps.getRemoteCursors` doc. Omitted when the host never wires `useCollabSession` up. */
  getRemoteCursors?(): readonly RemoteCursorOverlay[];
  /**
   * The document's page list, owned and seeded by the shell (see `deviva-draw-shell.tsx`). When
   * present it is the single source of truth for the live scene: this hook subscribes and rebuilds
   * the runtime whenever the active page's `Scene` changes; autosave/open/save become document-level.
   * Absent ⇒ the original single-scene behavior, byte for byte.
   */
  pageStore?: PageStore | null;
}

export interface UseDevivaRuntimeResult {
  runtime: DevivaRuntime | null;
  editSession: TextEditSession | null;
  handle: DevivaDrawHandle | null;
  /** Live "can autosave still save?" signal for the chrome's storage-full warning — see `autosave-status-store.ts`. */
  autosaveStatus: AutosaveStatusStore;
  /**
   * Version history's scheduler, or `null` while it is still starting / for a host that has no
   * version history at all (no IndexedDB, `initialData`-managed persistence, or no page store).
   *
   * A stable getter rather than a returned value: the scheduler starts asynchronously, after the
   * image restore settles, and turning that into React state would re-render every consumer of this
   * hook for an event none of them can act on. Callers that need to *react* to its arrival get that
   * in the history panel's own hook; callers that only need to fire a milestone (a room join, a file
   * open) want exactly this — "give me the scheduler if there is one".
   */
  getVersionScheduler(): VersionSnapshotScheduler | null;
  /** Version history's store once it has opened, or `null` where this host has none. Same stable-getter reasoning as `getVersionScheduler`. */
  getVersionStore(): VersionStore | null;
  /** The image file store once it has opened, or `null` where this host has none — what a version preview reads its pictures from, and what a restore rehydrates from. */
  getFileStore(): FileStoreLike | null;
  /**
   * Runs one orphan-collection pass with the current keep-set — the same pass a document swap runs.
   *
   * Exposed because deleting version records does not delete the images they were protecting: those
   * are reclaimed only when collection next notices nothing points at them. "Clear history" that did
   * not call this would empty a list while leaving every byte behind, which is not what the user
   * asked for when they cleared their history.
   */
  collectUnusedFiles(): Promise<void>;
  /**
   * Forces one repaint of the static canvas layer.
   *
   * Bringing stored image bytes back into a scene deliberately does not notify (see
   * `restore-document-files.ts`: a restore is not an edit, and treating it as one would mark the
   * document dirty on boot). The cost of that decision is that the caller has to ask for the frame —
   * which a restore of a stored version must, since its images arrive after the document is already
   * on screen.
   */
  repaint(): void;
}

function buildInitialScene(initialData: SceneDocument | MultiPageDocumentV1 | null | undefined, persistenceKey: string | undefined): Scene {
  if (initialData) {
    const result = Scene.fromJSON(initialData);
    if (result.ok) return result.scene;
    console.warn("deviva-draw: initialData failed validation, starting with an empty scene");
  }
  return restoreBrowserAutosave(persistenceKey) ?? new Scene();
}

export function useDevivaRuntime(options: UseDevivaRuntimeOptions): UseDevivaRuntimeResult {
  const { containerRef, cameraStore, initialData, persistenceKey, onChange, ui, shareApiBaseUrl, fileOperations, onDocumentStateChange, getThemeMode, toggleThemeMode, getToolLocked, isChromeOverlayOpen, getRemoteCursors, pageStore } = options;
  const sceneRef = useRef<Scene | null>(null);
  // File identity + synchronous content-only dirty flag — survives runtime rebuilds/page swaps
  // (a ref, created once). Fed by the scene/page-store subscriptions below; consumed by the
  // `onDocumentStateChange` prop and the desktop shell's save/close flows.
  const documentStateRef = useRef<DocumentStateTracker | null>(null);
  if (documentStateRef.current === null) documentStateRef.current = new DocumentStateTracker();
  const documentState = documentStateRef.current;
  // Created here rather than inside the autosave effect so it survives every runtime rebuild (page
  // swap, file open): "storage is full" is a property of the browser, not of the scene on screen, and
  // a warning that vanished on a page switch would be a warning the user never gets to act on.
  const autosaveStatusRef = useRef<AutosaveStatusStore | null>(null);
  if (autosaveStatusRef.current === null) autosaveStatusRef.current = createAutosaveStatusStore();
  const autosaveStatus = autosaveStatusRef.current;
  // Image payloads are persisted here instead of inside the autosave document — see
  // `browser/indexeddb-file-store.ts` for why (a small synchronous store is the wrong home for
  // megabytes of pixels). Opened once per mount, and never at all for a host that manages its own
  // data: `initialData` means this component is not the thing responsible for persistence.
  const fileStoreRef = useRef<Promise<FileStoreLike | null> | null>(null);
  if (fileStoreRef.current === null && !initialData) fileStoreRef.current = openIndexedDbFileStore();
  const fileStore = fileStoreRef.current;
  // Resolves once those payloads are back in their scenes. Held across rebuilds because it gates
  // saving and exporting, which must not depend on which page happens to be open.
  const filesRestoredRef = useRef<Promise<void> | null>(null);
  // Version history's own database, opened beside the file store and on the same terms: once per
  // mount, never for a host that manages its own persistence. A separate database rather than a
  // second store in `devivadraw-files`, so images never wait behind a schema upgrade for a feature
  // they do not need.
  const versionStoreRef = useRef<Promise<VersionStore | null> | null>(null);
  if (versionStoreRef.current === null && !initialData) versionStoreRef.current = openIndexedDbVersionStore();
  const versionStore = versionStoreRef.current;
  // The scheduler outlives every runtime rebuild — its cadence is a property of the session, not of
  // whichever page is on screen, and re-creating it per page switch would reset the five-minute
  // window every time the user looked at another page. Started once, disposed once (see the
  // unmount-only effect below).
  const versionSchedulerRef = useRef<VersionSnapshotScheduler | null>(null);
  const versionSchedulerStartedRef = useRef(false);
  // The live document autosave controller, held so the scheduler — created once — can always read the
  // *current* one's `snapshotDocument`. A rebuild replaces the controller; a scheduler that captured
  // the first one would keep serialising through a disposed writer's exclusion set.
  const documentAutosaveRef = useRef<DocumentAutosaveController | null>(null);
  const getVersionScheduler = useCallback(() => versionSchedulerRef.current, []);
  // The version store once it has opened, for the panel's own operations (listing, restoring,
  // clearing). `null` until then, and forever where there is no version history at all.
  const openedVersionStoreRef = useRef<VersionStore | null>(null);
  const getVersionStore = useCallback(() => openedVersionStoreRef.current, []);
  // The image store, resolved. Held separately from the `fileStore` promise so a caller in an event
  // handler can ask "is there one?" without awaiting. Subscribed once, not per render — the promise
  // never changes, and a `.then` per render would pile up callbacks for the lifetime of the mount.
  const openedFileStoreRef = useRef<FileStoreLike | null>(null);
  const fileStoreSubscribedRef = useRef(false);
  if (fileStore && !fileStoreSubscribedRef.current) {
    fileStoreSubscribedRef.current = true;
    void fileStore.then((store) => (openedFileStoreRef.current = store)).catch(() => undefined);
  }
  const getFileStore = useCallback(() => openedFileStoreRef.current, []);

  // The keep-set every collection pass is judged against, including its refusal case — see
  // `collection-keep-set.ts`, which is where that decision lives and is tested.
  const collectionKeepSet = useCallback(() => buildCollectionKeepSet(retainedFileIds(persistenceKey), versionStore), [versionStore, persistenceKey]);

  /**
   * One orphan-collection pass on demand — see `UseDevivaRuntimeResult.collectUnusedFiles`.
   *
   * Waits on `filesRestoredRef` for the same reason the boot path does: collecting before the
   * restore has put the bytes back into their scenes would judge "is anything still referencing
   * this?" against scenes that have not finished loading, and delete on the strength of it.
   */
  const collectUnusedFiles = useCallback(async () => {
    if (!fileStore) return;
    try {
      const [store] = await Promise.all([fileStore, filesRestoredRef.current]);
      if (!store) return;
      const scenes = pageStore ? pageStore.getScenes() : sceneRef.current ? [sceneRef.current] : [];
      await collectOrphanedFiles(scenes, store, await collectionKeepSet());
    } catch (error) {
      console.warn("deviva-draw: could not collect unused image data", error);
    }
  }, [fileStore, pageStore, collectionKeepSet]);

  const stageRef = useRef<CanvasStage | null>(null);
  // Through the ref, not a captured stage: the stage a caller last saw may already have been replaced
  // by a runtime rebuild.
  const repaint = useCallback(() => stageRef.current?.staticLayer.invalidate(), []);
  if (sceneRef.current === null) sceneRef.current = pageStore ? pageStore.getActiveScene() : buildInitialScene(initialData, persistenceKey);

  const [runtime, setRuntime] = useState<DevivaRuntime | null>(null);
  const [editSession, setEditSession] = useState<TextEditSession | null>(null);
  const [handle, setHandle] = useState<DevivaDrawHandle | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);

  // With a page store, every scene swap — page switch, file open, "new scene", share-link load —
  // flows through the store, and this subscription is the ONE place that turns "the active page's
  // Scene changed" into a runtime rebuild. (The store also notifies on rename/add-behind-the-scenes,
  // where the active Scene is unchanged and no rebuild happens.)
  useEffect(() => {
    if (!pageStore) return;
    // Dirty tracking, page-list half: only CONTENT revisions count (add/rename/delete/replace) —
    // `setActivePage` notifies without bumping the revision, so page switching stays clean.
    let seenContentRevision = pageStore.getContentRevision();
    return pageStore.subscribe(() => {
      const contentRevision = pageStore.getContentRevision();
      if (contentRevision !== seenContentRevision) {
        seenContentRevision = contentRevision;
        documentState.markContentChanged();
      }
      const active = pageStore.getActiveScene();
      if (active !== sceneRef.current) {
        sceneRef.current = active;
        setSceneVersion((version) => version + 1);
      }
    });
  }, [pageStore, documentState]);

  // State-out to the host (desktop title bar / documentEdited / recents) — fires on every dirty or
  // identity transition. `useStableCallback` semantics via manual latest-ref would be overkill:
  // hosts pass a stable function (module-level in the desktop shell).
  useEffect(() => {
    if (!onDocumentStateChange) return;
    onDocumentStateChange(documentState.getState());
    return documentState.subscribe(() => onDocumentStateChange(documentState.getState()));
  }, [onDocumentStateChange, documentState]);

  // Stable regardless of whether the host passes a memoized `onChange` — see the module doc. Always
  // resolves to whichever `onChange` this hook was most recently called with; a `undefined` prop on
  // the latest render is a safe no-op call, not a missing-callback error.
  const stableOnChange = useStableCallback((elements: AnyElement[], files: Record<string, LiveStoredFile>) => onChange?.(elements, files));

  useEffect(() => {
    const container = containerRef.current;
    const scene = sceneRef.current;
    if (!container || !scene) return;

    const stage = new CanvasStage();
    stage.mount(container);
    stageRef.current = stage;
    const unsubscribeInvalidate = scene.subscribe(() => stage.staticLayer.invalidate());
    // Dirty tracking, scene half: every element/file/layer mutation on the ACTIVE scene is content.
    // Synchronous by construction (Scene.notify is synchronous) — no debounce between an edit and
    // the dirty flag. Camera changes never notify the scene, so pan/zoom stays clean. Switching
    // the ACTIVE layer notifies too but is a view action (same policy as page switching — the plan
    // says look-only sessions must close without a prompt), so a notify whose only observable
    // change is the active-layer id is skipped; `setActiveLayer` is its own mutation, never
    // bundled with a content edit in one notify.
    let seenActiveLayerId = scene.getActiveLayerId();
    const unsubscribeDirty = scene.subscribe(() => {
      const activeLayerId = scene.getActiveLayerId();
      if (activeLayerId !== seenActiveLayerId) {
        seenActiveLayerId = activeLayerId;
        return;
      }
      documentState.markContentChanged();
    });

    // Bring back the image payloads the restored document only holds references to, and collect the
    // ones it no longer mentions. The RESTORE is once per mount: after that, every scene in the
    // document already carries its own bytes.
    if (fileStore && filesRestoredRef.current === null) {
      const scenes = pageStore ? pageStore.getScenes() : [scene];
      // Synchronously, ahead of the database open: the first frames are painted in that gap, and an
      // image whose bytes are merely on their way must not be painted as broken.
      expectStoredFiles(scenes);
      filesRestoredRef.current = fileStore
        .then(async (store) => {
          if (!store) {
            for (const pending of scenes) pending.stopExpectingFiles(referencedFileIds(scenes));
            return;
          }
          const { restored } = await restoreDocumentFiles(scenes, store, await collectionKeepSet());
          // A restore is not a scene change (see `restore-document-files.ts`), so nothing repaints on
          // its own — the canvas has to be told, and via the ref because the stage this mount created
          // may already have been replaced by a rebuild.
          if (restored > 0) stageRef.current?.staticLayer.invalidate();
        })
        .catch((error: unknown) => console.warn("deviva-draw: could not restore image data — images may be missing until the next save", error));
    } else if (fileStore) {
      // COLLECTION, though, runs on every rebuild — and a rebuild is exactly a whole-document swap
      // (a file opened, a share link loaded, a page switched). The document that was on screen a
      // moment ago is gone along with its history, so its images cannot be undone back into
      // existence; waiting for the next boot to notice would leave them on disk for the rest of the
      // session. "Reset canvas" deliberately does NOT rebuild — an undo can still bring those
      // elements back, so their bytes wait.
      void Promise.all([fileStore, filesRestoredRef.current])
        .then(async ([store]) => store && collectOrphanedFiles(pageStore ? pageStore.getScenes() : [scene], store, await collectionKeepSet()))
        .catch((error: unknown) => console.warn("deviva-draw: could not collect unused image data", error));
    }

    // Autosave gets the store only once that restore has finished, and this ordering is load-bearing.
    // Collection DELETES rows, while autosave seeds its memory of "already stored" from the same
    // listing: seeded first, that memory names ids the database no longer holds — and since ids are
    // content hashes, re-adding the very same image is then skipped as already-stored *and* left out
    // of the document, so its bytes end up in neither place. Waiting costs a few hundred milliseconds
    // of writing images inline, which is exactly what the pre-settled window is for.
    const autosaveFileStore = fileStore ? Promise.all([fileStore, filesRestoredRef.current]).then(([store]) => store) : undefined;

    // Register the bundled hand-drawn font, then force one repaint so any already-painted text
    // reflows from the fallback sans into the real face once it's ready (a data-URI font settles fast,
    // but not necessarily before the first frame). `cancelled` guards a late resolve after unmount.
    let fontsCancelled = false;
    void loadTextFonts(document).then(() => {
      if (!fontsCancelled) stage.staticLayer.invalidate();
    });

    const usingHostManagedData = Boolean(initialData);
    // Split out from `autosave` below because only the DOCUMENT flavour can feed version history: a
    // single `Scene` has no multi-page document to snapshot, which is exactly why the seam lives on
    // its own controller type rather than on the engine's (see `DocumentAutosaveController`).
    const documentAutosave = usingHostManagedData
      ? null
      : pageStore
        ? startBrowserDocumentAutosave(
            pageStore,
            scene,
            persistenceKey,
            { getCamera: cameraStore.getCamera, subscribe: cameraStore.subscribe },
            // Origin marker for the desktop shell's scratch-preservation logic (browser hosts write
            // it too — harmless extra envelope fields the readers ignore).
            () => {
              const state = documentState.getState();
              return { originPath: state.path, unsaved: state.dirty };
            },
            autosaveStatus,
            autosaveFileStore,
          )
        : null;
    // The single-scene fallback, unchanged: reached only when there is no page store and the host is
    // not managing its own data. Everything downstream still talks to `autosave`, whichever it is.
    const autosave = documentAutosave ?? (usingHostManagedData || pageStore ? null : startBrowserAutosave(scene, persistenceKey, autosaveStatus, autosaveFileStore));
    // Published for the version scheduler, which is created once and must always serialise through
    // whichever controller is live now — see the ref's own doc.
    documentAutosaveRef.current = documentAutosave;

    // Version history starts once per session, and only after the image restore has settled. The
    // ordering is the same one the autosave offload needs (see the comment above it): a snapshot
    // taken before the restore names files the scenes have not re-registered, so it would reference
    // bytes nothing in memory holds — and, once Phase 2's keep-set exists, would then protect them
    // from collection on the strength of a document that was never really the board.
    if (versionStore && documentAutosave && !versionSchedulerStartedRef.current) {
      versionSchedulerStartedRef.current = true;
      void Promise.all([versionStore, filesRestoredRef.current])
        .then(([store]) => {
          if (!store) return;
          openedVersionStoreRef.current = store;
          versionSchedulerRef.current = startVersionSnapshotScheduler({
            store,
            // Read through the ref, never captured: this closure outlives the controller it was
            // created beside.
            snapshotDocument: () => documentAutosaveRef.current!.snapshotDocument(),
            getContentRevision: () => documentState.getContentRevision(),
          });
        })
        .catch((error: unknown) => console.warn("deviva-draw: could not start version history", error));
    }

    // Autosave only writes in response to a scene *change*, and a scene that was just opened from a
    // file has none — so without this, opening a document and reloading restored the document from
    // *before* the open. Only on a swap (`sceneVersion > 0`); on first mount the scene either came
    // from this very storage slot or is empty, and writing an empty document over nothing would
    // create a save where the user has none.
    if (sceneVersion > 0) autosave?.flush();

    /**
     * Records the board *before* an operation that replaces the whole document. Fire-and-forget by
     * design: the swap must not wait on a database, and the snapshot's content is captured
     * synchronously inside `snapshotNow` precisely so it can be (see the scheduler's `capture`).
     *
     * A no-op while the scheduler is still starting, or where there is none at all. That is the
     * honest behaviour: the alternative — blocking a file open on version history being ready —
     * would make a feature about not losing work into a reason to wait for it.
     */
    const milestone = (reason: MilestoneReason) => void versionSchedulerRef.current?.snapshotNow("milestone", reason);

    const onSceneReplaced = (opened: Scene) => {
      milestone("before-open");
      // Pages mode: a single-scene load (the imperative `loadScene` API) becomes a whole-document
      // replace; the page-store subscription above performs the actual swap.
      if (pageStore) {
        pageStore.replaceAll([{ id: generatePageId(), name: "Page 1", scene: opened }], null);
        return;
      }
      sceneRef.current = opened;
      cameraStore.setCamera(createCamera());
      setSceneVersion((version) => version + 1);
    };

    const builtRuntime = buildRuntime({
      container,
      scene,
      getCamera: cameraStore.getCamera,
      setCamera: cameraStore.setCamera,
      ui,
      createPersistence: ({ history, selection }) => {
        const persistence = buildPersistenceOperations({
          getScene: () => sceneRef.current!,
          history,
          selection,
          onSceneReplaced,
          pages: pageStore
            ? {
                getDocument: () => pageStore.toDocument(false, cameraStore.getCamera()),
                replaceDocument: (document) => {
                  milestone("before-open");
                  pageStore.replaceAll(document.pages, document.activePageId);
                },
              }
            : undefined,
          shareApiBaseUrl,
          fileOperations,
          getFilePath: () => documentState.getState().path,
          whenFilesReady: () => filesRestoredRef.current ?? Promise.resolve(),
          restoreMissingFiles: async () => {
            const store = await fileStore;
            if (!store) return;
            const restored = await restoreSceneFiles([sceneRef.current!], store);
            if (restored > 0) stageRef.current?.staticLayer.invalidate();
          },
          onFileIdentity: (identity) => {
            documentState.markSaved(identity);
            // Re-stamp the autosave slot immediately: a save/open changes originPath/unsaved with
            // no scene mutation, so without this flush the marker would go stale until the next edit.
            autosave?.flush();
          },
        });
        return {
          ...persistence,
          // "Reset canvas" is the one document-emptying operation that is NOT a runtime rebuild —
          // it is an undo-batched clear, deliberately so, since an undo can bring every element
          // back (see the collection comment above). That makes it easy to under-estimate: a user
          // who clears, draws for an hour, then wants the old board back has walked past the end of
          // the undo stack. The milestone is that board's only remaining copy.
          newScene: () => {
            milestone("before-clear");
            persistence.newScene();
          },
        };
      },
      shareApiBaseUrl,
      getThemeMode,
      toggleThemeMode,
      getToolLocked,
      isChromeOverlayOpen,
    });

    // Layer-gating selection prune: when a layer becomes hidden or locked (locally OR via a remote
    // peer's mutation — both arrive through the same notify), its elements fall out of the live
    // selection, so keyboard nudges/deletes can never mutate content the user can't see or grab.
    // Individually-locked elements deliberately stay selected — the existing lock-then-unlock
    // selection flow depends on that; only the LAYER flags prune here. The layers-version gate is
    // load-bearing for performance: a drag fires one notify per selected element per frame, and an
    // unconditional scan here would go quadratic in selection size on exactly the drag-all stress
    // path — so the scan runs only when a LAYER actually changed, an O(1) check otherwise.
    let prunedAtLayersVersion = scene.getLayersVersion();
    const unsubscribeSelectionPrune = scene.subscribe(() => {
      const layersVersion = scene.getLayersVersion();
      if (layersVersion === prunedAtLayersVersion) return;
      prunedAtLayersVersion = layersVersion;
      const selected = builtRuntime.selection.getSelectedIds();
      if (selected.size === 0) return;
      const kept = [...selected].filter((id) => {
        const element = scene.getElement(id);
        return element !== undefined && !scene.isElementHidden(element) && !(scene.effectiveLocked(element) && !element.locked);
      });
      if (kept.length !== selected.size) builtRuntime.selection.selectOnly(kept);
    });

    setRuntime(builtRuntime);
    setEditSession(builtRuntime.editSession);
    setHandle(
      buildImperativeHandle({
        scene,
        selection: builtRuntime.selection,
        history: builtRuntime.history,
        panZoomTool: builtRuntime.panZoomTool,
        createExportRenderTarget: createBrowserExportRenderTarget,
        createRoughSvgGenerator,
        textMeasurer: createCanvasTextMeasurer(document.createElement("canvas").getContext("2d")!),
        imageDecodeCache: new ImageDecodeCache(createBrowserImageDecoder()),
        documentControl: {
          // A blank document, the way `openDocument` replaces one — same swap, same autosave flush,
          // but with no file behind it. The identity reset is the part that matters: a document that
          // kept its old path here would let the next Save write this new, empty (or, once a room's
          // board arrives, someone else's) content straight over the user's own file.
          newDocument: () => {
            // Only the page-store branch below can reach version history (see `documentAutosave`),
            // so the `onSceneReplaced` fallback's own `before-open` milestone cannot double-fire
            // alongside this one — that path has no scheduler at all.
            milestone("before-clear");
            if (pageStore) pageStore.replaceAll([{ id: generatePageId(), name: "Page 1", scene: new Scene() }], null);
            else onSceneReplaced(new Scene());
            cameraStore.setCamera(createCamera());
            documentState.markNewDocument();
            autosave?.flush();
          },
          // Same dispatch the in-shell menu/palette use — one action surface for native menus too.
          runAction: (actionId) => {
            if (!builtRuntime.actionRegistry.list().some((action) => action.id === actionId)) return false;
            builtRuntime.actionRegistry.run(actionId, builtRuntime);
            return true;
          },
          openDocument: (text, path, openOptions) => {
            const opened = documentFromFileText(text);
            if (!opened) return false;
            // Live-reload contract: an external-change reload must not jump the viewport — capture
            // the camera across the swap (replaceAll/page effects would otherwise restore the
            // FILE's parked camera, which is wherever the agent's write left it).
            const camera = openOptions?.preserveCamera ? cameraStore.getCamera() : null;
            milestone("before-open");
            if (pageStore) pageStore.replaceAll(opened.pages, opened.activePageId);
            else {
              const first = opened.pages[0]?.scene;
              if (!first) return false;
              onSceneReplaced(first);
            }
            if (camera) cameraStore.setCamera(camera);
            const name = path ? (path.split(/[/\\]/).pop() ?? path) : "Untitled";
            documentState.markSaved({ path, name });
            autosave?.flush();
            return true;
          },
          saveDocument: (saveOptions) => builtRuntime.persistence.saveSceneOutcome?.(saveOptions) ?? Promise.resolve("canceled" as const),
          // Deleted elements stripped, images embedded — the shape a save writes, because every host
          // that asks for this wants something openable later, not the internal autosave payload.
          getDocument: () => (pageStore ? pageStore.toDocument(false, cameraStore.getCamera()) : sceneRef.current!.toJSON()),
        },
      }),
    );

    const stopRenderLoop = startRenderLoop({
      stage,
      scene,
      cameraStore,
      selection: builtRuntime.selection,
      getMarqueeRect: builtRuntime.getMarqueeRect,
      getSnapGuides: builtRuntime.getSnapGuides,
      grid: builtRuntime.grid,
      getRemoteCursors,
      getTextDraft: () => {
        const state = builtRuntime.editSession.getState();
        return state.status === "editing" ? { elementId: state.elementId, text: state.draftText } : null;
      },
      getPendingEraseIds: builtRuntime.getPendingEraseIds,
      getLaserTrail: builtRuntime.getLaserTrail,
      getLassoPath: builtRuntime.getLassoPath,
      getBindingHighlightIds: builtRuntime.getBindingHighlightIds,
      getBindingAnchor: builtRuntime.getBindingAnchor,
      getHoverPoint: builtRuntime.getHoverPoint,
      getCursor: builtRuntime.getCursor,
      // The same resolved-theme source `getColorAdapter` keys on, rather than a second derivation —
      // `getThemeMode()` has already collapsed "system" to a concrete light/dark.
      getTheme: getThemeMode,
      // Adapt default-palette colors to the live theme at render time (non-destructive) so a scene is
      // legible whatever theme it was authored/loaded in — the fix for near-black strokes on a dark
      // canvas that a load/collab/share can't otherwise resolve. Custom colors + images pass through.
      getColorAdapter: () => {
        const mode = getThemeMode();
        return { key: mode, stroke: (color) => adaptStrokeColorForTheme(color, mode), background: (color) => adaptBackgroundColorForTheme(color, mode) };
      },
    });

    // Always subscribed (not gated on whether `onChange` was passed at *mount* time) — `stableOnChange`
    // resolves to whatever the host's `onChange` prop is on every call, including one added on a
    // later render after starting `undefined`; an absent `onChange` just makes each debounced tick a
    // cheap no-op rather than skipping the subscription (and needing to re-subscribe later) entirely.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeOnChange = scene.subscribe(() => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        stableOnChange(getLiveElements(scene), getLiveFiles(scene));
      }, ON_CHANGE_DEBOUNCE_MS);
    });

    return () => {
      fontsCancelled = true;
      stopRenderLoop();
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      unsubscribeOnChange();
      unsubscribeInvalidate();
      unsubscribeDirty();
      unsubscribeSelectionPrune();
      autosave?.dispose();
      builtRuntime.dispose();
      stage.unmount();
      setRuntime(null);
      setEditSession(null);
      setHandle(null);
    };
    // Deliberately keyed only on `sceneVersion` — this mount effect rebuilds the whole runtime only
    // on an explicit scene swap ("Open"). `containerRef`/`ui`/`initialData`/`persistenceKey` are
    // expected stable for the component's lifetime (both are read once, at mount, to seed the initial
    // scene/autosave key — a later change is not meant to hot-swap either); `onChange`/`getThemeMode`/
    // `toggleThemeMode`/`isChromeOverlayOpen` are read through stable wrappers (see the module doc)
    // precisely so they *don't* need to be stable themselves.
  }, [sceneVersion]);

  return { runtime, editSession, handle, autosaveStatus, getVersionScheduler, getVersionStore, getFileStore, collectUnusedFiles, repaint };
}
