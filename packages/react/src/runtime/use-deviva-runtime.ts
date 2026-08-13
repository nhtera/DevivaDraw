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
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  createBrowserImageDecoder,
  createCamera,
  createCanvasTextMeasurer,
  CanvasStage,
  ImageDecodeCache,
  loadTextFonts,
  Scene,
} from "@deviva-draw/engine";
import type { AnyElement, RemoteCursorOverlay, SceneDocument, TextEditSession } from "@deviva-draw/engine";
import { buildPersistenceOperations } from "./build-persistence-operations";
import { buildRuntime } from "./build-runtime";
import type { DevivaDrawHandle } from "./imperative-handle";
import { buildImperativeHandle } from "./imperative-handle";
import { restoreBrowserAutosave, startBrowserAutosave } from "../browser/scene-file-operations";
import { createBrowserExportRenderTarget, createRoughSvgGenerator } from "../browser/persistence-adapters";
import { getLiveElements, getLiveFiles } from "./scene-live-snapshot";
import type { LiveStoredFile } from "./scene-live-snapshot";
import { startRenderLoop } from "./start-render-loop";
import type { CameraStore } from "./camera-store";
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
  initialData?: SceneDocument | null;
  /** Scopes localStorage autosave to this key — see `DevivaDrawProps.persistenceKey`'s doc. Ignored whenever `initialData` is supplied (host-managed persistence, autosave stays off). */
  persistenceKey?: string;
  onChange?(elements: AnyElement[], files: Record<string, LiveStoredFile>): void;
  ui: UiToggleState;
  /** The collab-server's base URL, forwarded to `buildPersistenceOperations` for the "Share" action — see that module's `shareApiBaseUrl` doc. */
  shareApiBaseUrl?: string;
  getThemeMode(): ThemeMode;
  toggleThemeMode(): void;
  /** `true` while the tool lock is engaged — see `build-runtime.ts`'s `getToolLocked` doc. */
  getToolLocked(): boolean;
  /** `true` while the command palette, shortcuts dialog, main menu, or context menu is open — suppresses the global keyboard-shortcut resolver so typing into an overlay's search input can never leak through and switch tools (see `build-runtime.ts`'s `isChromeOverlayOpen` doc). */
  isChromeOverlayOpen(): boolean;
  /** Live collaborator cursors for the interactive layer — see `start-render-loop.ts`'s `RenderLoopDeps.getRemoteCursors` doc. Omitted when the host never wires `useCollabSession` up. */
  getRemoteCursors?(): readonly RemoteCursorOverlay[];
}

export interface UseDevivaRuntimeResult {
  runtime: DevivaRuntime | null;
  editSession: TextEditSession | null;
  handle: DevivaDrawHandle | null;
}

function buildInitialScene(initialData: SceneDocument | null | undefined, persistenceKey: string | undefined): Scene {
  if (initialData) {
    const result = Scene.fromJSON(initialData);
    if (result.ok) return result.scene;
    console.warn("deviva-draw: initialData failed validation, starting with an empty scene");
  }
  return restoreBrowserAutosave(persistenceKey) ?? new Scene();
}

export function useDevivaRuntime(options: UseDevivaRuntimeOptions): UseDevivaRuntimeResult {
  const { containerRef, cameraStore, initialData, persistenceKey, onChange, ui, shareApiBaseUrl, getThemeMode, toggleThemeMode, getToolLocked, isChromeOverlayOpen, getRemoteCursors } = options;
  const sceneRef = useRef<Scene | null>(null);
  if (sceneRef.current === null) sceneRef.current = buildInitialScene(initialData, persistenceKey);

  const [runtime, setRuntime] = useState<DevivaRuntime | null>(null);
  const [editSession, setEditSession] = useState<TextEditSession | null>(null);
  const [handle, setHandle] = useState<DevivaDrawHandle | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);

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
    const unsubscribeInvalidate = scene.subscribe(() => stage.staticLayer.invalidate());

    // Register the bundled hand-drawn font, then force one repaint so any already-painted text
    // reflows from the fallback sans into the real face once it's ready (a data-URI font settles fast,
    // but not necessarily before the first frame). `cancelled` guards a late resolve after unmount.
    let fontsCancelled = false;
    void loadTextFonts(document).then(() => {
      if (!fontsCancelled) stage.staticLayer.invalidate();
    });

    const usingHostManagedData = Boolean(initialData);
    const autosave = usingHostManagedData ? null : startBrowserAutosave(scene, persistenceKey);

    // Autosave only writes in response to a scene *change*, and a scene that was just opened from a
    // file has none — so without this, opening a document and reloading restored the document from
    // *before* the open. Only on a swap (`sceneVersion > 0`); on first mount the scene either came
    // from this very storage slot or is empty, and writing an empty document over nothing would
    // create a save where the user has none.
    if (sceneVersion > 0) autosave?.flush();

    const onSceneReplaced = (opened: Scene) => {
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
      createPersistence: ({ history, selection }) => buildPersistenceOperations({ getScene: () => sceneRef.current!, history, selection, onSceneReplaced, shareApiBaseUrl }),
      shareApiBaseUrl,
      getThemeMode,
      toggleThemeMode,
      getToolLocked,
      isChromeOverlayOpen,
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
      getHoverPoint: builtRuntime.getHoverPoint,
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

  return { runtime, editSession, handle };
}
