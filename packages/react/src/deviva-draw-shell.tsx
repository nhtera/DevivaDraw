/**
 * The composed chrome shell, mounted inside `<ThemeProvider/>`/`<LocaleProvider/>` by
 * `deviva-draw-app.tsx` — canvas host, toolbar (desktop) or bottom toolbar (mobile), top bar,
 * properties panel, context menu, main menu, shortcuts dialog, command palette, and the text-editor/
 * paste-drop overlays wired to the theme-aware, camera-reactive runtime.
 *
 * Two nested divs, not one: `rootRef` (sized/styled by the host, holds every chrome
 * button/panel/menu as a plain sibling) and `canvasHostRef` (an absolutely-positioned `inset: 0`
 * child, the *only* element `@deviva-draw/engine`'s `PointerEventPipeline`/`CanvasStage` ever touch).
 * They must stay separate — `PointerEventPipeline` calls `setPointerCapture` on its target element on
 * every `pointerdown` inside it (see that module's doc); a chrome `<button>` nested *inside* that same
 * captured element never receives its synthetic `click` event once capture redirects it, silently
 * breaking every toolbar/panel/menu button. Keeping chrome as `rootRef` siblings instead of
 * `canvasHostRef` descendants avoids this entirely rather than special-casing it per component.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createCamera, deserializeMultiPageDocument } from "@deviva-draw/engine";
import type { RemoteCursorOverlay } from "@deviva-draw/engine";
import { restoreBrowserAutosaveDocument } from "./browser/scene-file-operations";
import { useKeyboardInsetPx } from "./browser/visual-viewport-inset";
import { PageStore } from "./pages/page-store";
import { useDocumentFileDrop } from "./hooks/use-document-file-drop";
import { useLibraryDrop } from "./hooks/use-library-drop";
import { usePasteAndDrop } from "./hooks/use-paste-and-drop";
import { useImageFilePicker } from "./hooks/use-image-file-picker";
import { shouldSuppressGlobalShortcuts } from "./runtime/should-suppress-global-shortcuts";
import { useCollabCursorTracking } from "./hooks/use-collab-cursor-tracking";
import { useCollabSession } from "./hooks/use-collab-session";
import { useLanHosting } from "./hooks/use-lan-hosting";
import { useFollowPeerCamera, usePublishLocalViewport } from "./hooks/use-follow-peer-camera";
import { TextEditorOverlay } from "./components/text-editor-overlay";
import { CanvasHint } from "./components/canvas-hint";
import { EmptyStateOverlay } from "./components/empty-state-overlay";
import { ensureChromeStylesheet } from "./components/chrome-stylesheet";
import { Toolbar } from "./components/toolbar";
import { TabletBottomControls, TopBar } from "./components/top-bar";
import { PropertiesPanel } from "./components/properties-panel";
import { ContextMenu } from "./components/context-menu";
import { ImagePlacementOverlay } from "./components/image-placement-overlay";
import { ImageCropOverlay } from "./components/image-crop-overlay";
import { TableCellEditorOverlay } from "./components/table-cell-editor-overlay";
import { LinkBadgesOverlay } from "./components/link-badges-overlay";
import { StatsPanel } from "./components/stats-panel";
import { PagesPanel } from "./components/pages-panel";
import { MainMenu } from "./components/main-menu";
import { ShareDialog } from "./components/share-dialog";
import { runShareScene } from "./actions/share-actions";
import { ShareViewerBadge } from "./components/share-viewer-badge";
import { LayersPanel } from "./components/layers-panel";
import { CommentsCanvasLayer } from "./components/comments/comments-canvas-layer";
import { CommentsPanel } from "./components/comments/comments-panel";
import { CollabDialog } from "./components/collab-dialog";
import { SessionEndedNotice } from "./components/session-ended-notice";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { FindPanel } from "./components/find-panel";
import { VersionHistoryPanel } from "./components/version-history-panel";
import { useVersionHistory } from "./hooks/use-version-history";
import { ExportDialog } from "./components/export-dialog";
import { LibraryPanel } from "./components/library-panel";
import { LibraryToggle } from "./components/library-toggle";
import { MermaidDialog } from "./components/mermaid-dialog";
import { EmbedDialog } from "./components/embed-dialog";
import { EmbedOverlay } from "./components/embed-overlay";
import { Minimap } from "./components/minimap";
import { BackToContentPill } from "./components/back-to-content-pill";
import { ExitZenPill } from "./components/exit-zen-pill";
import { CollabViewerBadge } from "./components/collab-viewer-badge";
import { FollowingPeerPill } from "./components/following-peer-pill";
import { AutosaveQuotaBanner } from "./components/autosave-quota-banner";
import { ImageInsertNotice } from "./components/image-insert-notice";
import { TopBannerStack } from "./components/top-banner-stack";
import { PresentationController } from "./components/presentation/presentation-controller";
import { useCanvasBackground } from "./runtime/use-live-version";
import { useAdaptNextShapeStyle } from "./runtime/use-adapt-next-shape-style";
import { CommandPalette } from "./components/command-palette";
import { BottomToolbar } from "./components/mobile/bottom-toolbar";
import { MobilePropertiesBar } from "./components/mobile/mobile-properties-bar";
import { useLayoutTier } from "./components/responsive-layout";
import { useTheme } from "./theme/theme-provider";
import { decodeNaturalSize, downscaleImage } from "./browser/browser-image-decode";
import { createCameraStore } from "./runtime/camera-store";
import { useContextMenuTriggers } from "./runtime/use-context-menu-triggers";
import { useStableCallback, useStableGetter } from "./runtime/use-stable-ref";
import { useDevivaRuntime } from "./runtime/use-deviva-runtime";
import { useToggleState } from "./runtime/use-toggle-state";
import { useValueState } from "./runtime/use-value-state";
import { NOOP_HANDLE } from "./runtime/noop-handle";
import type { DevivaDrawHandle } from "./runtime/imperative-handle";
import type { DevivaRuntime } from "./runtime/runtime-types";
import type { ShareDialogState } from "./actions/action-types";
import type { ImageInsertOutcome } from "./browser/image-insert-outcome";
import type { DevivaDrawProps } from "./deviva-draw-app-types";

export const DevivaDrawShell = forwardRef<DevivaDrawHandle, DevivaDrawProps>(function DevivaDrawShell(props, ref) {
  const { initialData, persistenceKey, onChange, className, style, initialViewOnly, shareApiBaseUrl, initialRoomUrl, fileOperations, onDocumentStateChange, lanHost, confirmDiscardChanges } = props;
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  // The document's page list, seeded once: host-supplied `initialData` wraps into a single page
  // (host-managed persistence, matching `useDevivaRuntime`'s own rule), otherwise the document
  // autosave restores — legacy single-scene autosaves come back as one page, so nothing is lost by
  // an upgrade to a pages-aware build.
  const pageStoreRef = useRef<PageStore | null>(null);
  if (pageStoreRef.current === null) {
    if (initialData) {
      // Accepts both envelopes — a host's single-scene snapshot loads as one page, a multi-page
      // document (e.g. the share viewer's) loads whole.
      const result = deserializeMultiPageDocument(initialData);
      if (!result.ok) console.warn("deviva-draw: initialData failed validation, starting with an empty scene");
      pageStoreRef.current = result.ok ? new PageStore(result.pages, result.activePageId) : PageStore.fresh();
    } else {
      const restored = restoreBrowserAutosaveDocument(persistenceKey);
      pageStoreRef.current = restored ? new PageStore(restored.pages, restored.activePageId) : PageStore.fresh();
    }
  }
  const pageStore = pageStoreRef.current;
  const { mode, cssVariables, toggleMode } = useTheme();
  const layoutTier = useLayoutTier();
  const isNarrow = layoutTier === "phone";
  // On-screen-keyboard occlusion (0 on desktop) — feeds the text/table editors' camera-pan keyboard avoidance.
  const keyboardInsetPx = useKeyboardInsetPx();

  // Inject the chrome's pseudo-class/motion stylesheet once (hover/focus-visible/press states +
  // reduced-motion-aware transitions) — see `chrome-stylesheet.ts`.
  useEffect(() => ensureChromeStylesheet(), []);


  // Owned here (not by `useDevivaRuntime`) so `useContextMenuTriggers` below — which needs a live
  // `CameraStore` to feed its `TouchGestureAdapter` — can be constructed *before* the runtime exists;
  // see `use-deviva-runtime.ts`'s `cameraStore` option doc.
  const cameraStoreRef = useRef<ReturnType<typeof createCameraStore> | null>(null);
  // Seeded from the active page's parked camera (a restored autosave/file/share document carries one
  // per page) so the very first paint already shows the saved viewport. The page-*switch* restore
  // below can't cover this: it only fires when the active id changes, and on mount it hasn't.
  cameraStoreRef.current ??= createCameraStore(pageStore.cameraFor(pageStore.getActivePageId()) ?? createCamera());
  const cameraStore = cameraStoreRef.current;

  const zenMode = useToggleState(false);
  const toolLock = useToggleState(false);
  const viewOnly = useToggleState(initialViewOnly ?? false);
  const statsPanel = useToggleState(false);
  const layersPanel = useToggleState(false);
  const commentsPanel = useToggleState(false);
  // Which thread's popover is open. Not a toggle: it is an id, and it must survive a re-render caused
  // by the very mutation the popover just made.
  const openCommentThreadId = useValueState<string | null>(null);
  // A just-placed comment pin asks the chrome to open its composer, the same window-event mechanism
  // the table tool uses to start editing a just-placed cell (`runtime/build-tools.ts`). Kept here in
  // the shell — not inside the canvas layer — because the shell owns which thread is open, and the
  // pin can be placed while the layer is showing no threads at all.
  useEffect(() => {
    const onOpenRequest = (event: Event) => {
      const threadId = (event as CustomEvent<{ threadId?: unknown }>).detail?.threadId;
      if (typeof threadId === "string") openCommentThreadId.set(threadId);
    };
    window.addEventListener("deviva:comment-thread-open", onOpenRequest);
    return () => window.removeEventListener("deviva:comment-thread-open", onOpenRequest);
  }, [openCommentThreadId]);
  // Defaults on, preserving the minimap's previous always-visible behavior; the toggle only adds a way out.
  const minimapVisible = useToggleState(true);
  // Same "defaults on, the toggle is only a way out" contract as the minimap above.
  const propertiesPanelVisible = useToggleState(true);
  const presentationActive = useToggleState(false);
  //
  // Zen hides the panel-class chrome (see the render tree below); presentation hides that AND the
  // toolbar/top bar, because a slide walk has its own controls and nothing else on screen belongs in
  // front of an audience.
  const panelsHidden = zenMode.value || presentationActive.value;
  // View-only is either the user's own toggle or presentation's temporary override. Derived rather
  // than written on enter (`viewOnly.set(true)`), so leaving presentation restores whatever the
  // user's own setting was without this component having to remember it.
  // Joining with a viewer link is the third source of view-only. It is mirrored into local state (set
  // by an effect once `useCollabSession` has run, further down) rather than read from `collab` here,
  // because that hook needs `runtime.scene` and so cannot be called this early — the same call-order
  // independence `remoteCursorsRef` exists for. The relay is the actual boundary; this only keeps the
  // UI honest instead of letting a viewer draw into a void.
  const collabViewer = useToggleState(false);
  const presentationViewOnly = viewOnly.value || presentationActive.value || collabViewer.value;
  const commandPaletteOpen = useToggleState(false);
  const shortcutsDialogOpen = useToggleState(false);
  const findOpen = useToggleState(false);
  const exportDialogOpen = useToggleState(false);
  const libraryOpen = useToggleState(false);
  const mermaidOpen = useToggleState(false);
  const embedOpen = useToggleState(false);
  const versionHistoryOpen = useToggleState(false);
  const mainMenuOpen = useToggleState(false);
  const shareDialog = useValueState<ShareDialogState>({ status: "closed" });
  const collabDialogOpen = useToggleState(false);
  // Mirror of `runtime` (declared below) for the context-menu trigger hook, which must attach its
  // listeners before the runtime exists but hit-tests the scene only at right-click time.
  // Stable identity (both inputs are ref-backed getters), so the runtime can hold it forever while
  // always reading the current values — same contract as `useToggleState`'s own `get`.
  const getEffectiveViewOnly = useCallback(
    () => viewOnly.get() || presentationActive.get() || collabViewer.get(),
    [viewOnly, presentationActive, collabViewer],
  );
  const runtimeForContextMenuRef = useRef<DevivaRuntime | null>(null);
  const contextMenuTriggers = useContextMenuTriggers(canvasHostRef, cameraStore, runtimeForContextMenuRef);

  // `use-deviva-runtime.ts`'s mount effect only re-runs on an explicit scene swap ("Open"), so it
  // freezes whatever `getThemeMode`/`toggleThemeMode`/`isChromeOverlayOpen` it received at that
  // moment — these stay a stable identity forever while always delegating to the *current* render's
  // actual value (review fix: dialog-open keydown leak + stale-onChange closure).
  const getThemeMode = useStableGetter(mode);
  const toggleThemeMode = useStableCallback(toggleMode);
  const isChromeOverlayOpen = useStableGetter(
    commandPaletteOpen.value ||
      shortcutsDialogOpen.value ||
      findOpen.value ||
      exportDialogOpen.value ||
      mermaidOpen.value ||
      embedOpen.value ||
      mainMenuOpen.value ||
      versionHistoryOpen.value ||
      shareDialog.value.status !== "closed" ||
      collabDialogOpen.value ||
      contextMenuTriggers.point !== null ||
      // Presentation owns the keyboard: its controller handles the navigation keys itself, and every
      // other global binding (tool letters, chrome toggles) must not fire behind a slide walk.
      presentationActive.value,
  );

  // Read by the render loop every frame (see `start-render-loop.ts`'s `getRemoteCursors` doc); kept as
  // a ref + a `useCallback([])`-stable getter, not a value derived from `useCollabSession`'s state
  // directly, precisely so it can be handed to `useDevivaRuntime` below *before* `useCollabSession` is
  // even called (that hook needs `runtime.scene`, which doesn't exist until after this call) without
  // either hook depending on the other's call order.
  const remoteCursorsRef = useRef<RemoteCursorOverlay[]>([]);
  const getRemoteCursors = useCallback(() => remoteCursorsRef.current, []);

  const { runtime, editSession, handle, autosaveStatus, getVersionScheduler, getVersionStore, getFileStore, collectUnusedFiles, repaint } = useDevivaRuntime({
    containerRef: canvasHostRef,
    cameraStore,
    initialData,
    persistenceKey,
    onChange,
    ui: {
      getZenMode: zenMode.get,
      setZenMode: zenMode.set,
      // Derived, not the raw toggle: presentation is view-only for its duration, and this getter is
      // what `ActionRegistry` checks before running any scene-mutating action (see
      // `Action.viewOnlyAllowed`). Reading only the user's own toggle here would leave every
      // mutating action live behind the presentation overlay.
      getViewOnly: getEffectiveViewOnly,
      setViewOnly: viewOnly.set,
      getStatsPanelVisible: statsPanel.get,
      setStatsPanelVisible: statsPanel.set,
      getLayersPanelVisible: layersPanel.get,
      setLayersPanelVisible: layersPanel.set,
      getVersionHistoryOpen: versionHistoryOpen.get,
      setVersionHistoryOpen: versionHistoryOpen.set,
      getCommentsPanelVisible: commentsPanel.get,
      setCommentsPanelVisible: commentsPanel.set,
      getMinimapVisible: minimapVisible.get,
      setMinimapVisible: minimapVisible.set,
      getPropertiesPanelVisible: propertiesPanelVisible.get,
      setPropertiesPanelVisible: propertiesPanelVisible.set,
      getToolLocked: toolLock.get,
      setToolLocked: toolLock.set,
      getPresentationActive: presentationActive.get,
      setPresentationActive: presentationActive.set,
      getCommandPaletteOpen: commandPaletteOpen.get,
      setCommandPaletteOpen: commandPaletteOpen.set,
      getShortcutsDialogOpen: shortcutsDialogOpen.get,
      setShortcutsDialogOpen: shortcutsDialogOpen.set,
      getShareDialogState: shareDialog.get,
      setShareDialogState: shareDialog.set,
    },
    shareApiBaseUrl,
    fileOperations,
    onDocumentStateChange,
    getThemeMode,
    toggleThemeMode,
    getToolLocked: toolLock.get,
    isChromeOverlayOpen,
    getRemoteCursors,
    pageStore,
  });

  // Camera-per-page: when the active page changes (switch, file open, "new scene"), restore that
  // page's parked camera — or the origin for a page never visited. Parking the outgoing page's
  // camera happens in the switch/add handlers below, which run *before* the store notifies.
  const activePageIdRef = useRef(pageStore.getActivePageId());
  useEffect(
    () =>
      pageStore.subscribe(() => {
        const nextActiveId = pageStore.getActivePageId();
        if (nextActiveId === activePageIdRef.current) return;
        activePageIdRef.current = nextActiveId;
        cameraStore.setCamera(pageStore.cameraFor(nextActiveId) ?? createCamera());
      }),
    [pageStore, cameraStore],
  );
  const parkCameraThen = (action: () => void) => {
    pageStore.saveCameraFor(pageStore.getActivePageId(), cameraStore.getCamera());
    action();
  };

  // View-only must mean "can view, not edit" at the input level, not just hidden chrome: the action
  // registry blocks every scene-mutating action (see `Action.viewOnlyAllowed`), and this effect
  // pins the active tool to pan so raw canvas gestures can only navigate. The pan pin re-applies on
  // every runtime rebuild while view-only (rebuilds reset the tool to the select default), but the
  // hand-back-to-select runs ONLY on the actual view-only exit edge — an unconditional reset here
  // would clobber the user's tool (locked or not) on every ordinary page switch, since `runtime`'s
  // identity changes with each rebuild.
  const wasViewOnlyRef = useRef(viewOnly.value);
  useEffect(() => {
    const wasViewOnly = wasViewOnlyRef.current;
    wasViewOnlyRef.current = viewOnly.value;
    if (!runtime) return;
    // Keyed to the user's own toggle, deliberately NOT the presentation-derived value: presentation
    // selects the laser tool itself, and pinning pan here would immediately override it.
    if (viewOnly.value) runtime.actionRegistry.run("pan-tool", runtime);
    else if (wasViewOnly) runtime.actionRegistry.run("select-tool", runtime);
  }, [runtime, viewOnly.value]);

  useImperativeHandle(ref, () => handle ?? NOOP_HANDLE, [handle]);
  runtimeForContextMenuRef.current = runtime;
  useAdaptNextShapeStyle(runtime, mode);

  const getCamera = useCallback(() => cameraStore.getCamera(), [cameraStore]);
  const getViewportSize = useCallback(
    () => ({ width: canvasHostRef.current?.clientWidth ?? 0, height: canvasHostRef.current?.clientHeight ?? 0 }),
    [],
  );
  // What just happened to an image insert — resized, or refused, and why. Transient: the notice
  // clears itself, and a fresh outcome replaces whatever was on screen.
  const [imageInsertOutcome, setImageInsertOutcome] = useState<ImageInsertOutcome | null>(null);
  const clearImageInsertOutcome = useCallback(() => setImageInsertOutcome(null), []);
  usePasteAndDrop({
    containerRef: canvasHostRef,
    // `null` scene in view-only detaches the listeners entirely — paste/drop are scene mutations.
    scene: presentationViewOnly ? null : (runtime?.scene ?? null),
    getCamera,
    getViewportSize,
    decodeNaturalSize,
    downscale: downscaleImage,
    onInsertOutcome: setImageInsertOutcome,
    onEmbeddedSceneDrop: (parsed) => {
      const result = deserializeMultiPageDocument(parsed);
      if (!result.ok) return false;
      pageStore.replaceAll(result.pages, result.activePageId);
      return true;
    },
  });
  // Shares the canvas host's drop target with `usePasteAndDrop` above — that one handles files dragged
  // in from outside, this one an in-document drag from the library sidebar. Each ignores the other's.
  useLibraryDrop({ containerRef: canvasHostRef, runtime: presentationViewOnly ? null : runtime, getCamera });
  // The third drop listener on that target: scene/library *documents* dragged in from the desktop.
  // A dropped library opens the sidebar, so its items are somewhere the user can see rather than
  // silently added to a shelf that is currently closed.
  useDocumentFileDrop({
    containerRef: canvasHostRef,
    runtime: presentationViewOnly ? null : runtime,
    pageStore,
    onLibraryImported: useCallback(() => libraryOpen.set(true), [libraryOpen]),
  });
  const { openImagePicker, pendingPlacement } = useImageFilePicker({
    // Nulled in view-only like the paste/drop hooks above — the "9" shortcut and placement click
    // dispatch straight to the scene, not through the action registry's view-only gate.
    scene: presentationViewOnly ? null : (runtime?.scene ?? null),
    history: presentationViewOnly ? null : (runtime?.history ?? null),
    selection: presentationViewOnly ? null : (runtime?.selection ?? null),
    containerRef: canvasHostRef,
    getCamera,
    getViewportSize,
    decodeNaturalSize,
    downscale: downscaleImage,
    onInsertOutcome: setImageInsertOutcome,
  });

  // The "9" image shortcut (matching Excalidraw) — image insert is a DOM file-picker action, not an
  // engine tool, so it's handled here rather than through the engine's ShortcutRegistry. Suppressed
  // whenever a text edit or chrome overlay owns the keyboard, and ignored while any input is focused.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "9" || event.metaKey || event.ctrlKey || event.altKey) return;
      const isEditingText = editSession?.getState().status === "editing";
      if (shouldSuppressGlobalShortcuts(Boolean(isEditingText), isChromeOverlayOpen())) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      event.preventDefault();
      openImagePicker();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editSession, isChromeOverlayOpen, openImagePicker]);

  // Cmd/Ctrl+F opens "find on canvas", overriding the browser's own find. Handled here (not via the
  // engine ShortcutRegistry) because it toggles a React overlay, not an engine tool.
  const openFind = findOpen.set;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "f" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      openFind(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openFind]);

  // "?" opens the keyboard-shortcuts dialog — the key every editor reserves for its help overlay.
  // Same React-overlay reasoning as Cmd+F above, and the same typing guards as the "9" image shortcut:
  // never fire while a text edit or chrome overlay owns the keyboard, or while an input is focused.
  const openShortcutsDialog = shortcutsDialogOpen.set;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      const isEditingText = editSession?.getState().status === "editing";
      if (shouldSuppressGlobalShortcuts(Boolean(isEditingText), isChromeOverlayOpen())) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      event.preventDefault();
      openShortcutsDialog(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editSession, isChromeOverlayOpen, openShortcutsDialog]);

  // Collaboration is opt-in and reuses the same collab-server base URL the "Share" action already
  // requires (`shareApiBaseUrl` — both are that Worker's endpoints, see `use-collab-session.ts`'s
  // `apiBaseUrl` doc) rather than introducing a second, near-identical prop.
  const canvasBackground = useCanvasBackground(runtime?.scene ?? null);
  // Version history's "before joining a room" milestone. Fired from inside the join rather than from
  // the call sites that trigger one (the dialog, the auto-join a room URL performs) because only the
  // hook knows the instant at which this peer's own board is still its own — see `onBeforeJoin`.
  const snapshotBeforeJoin = useCallback(() => void getVersionScheduler()?.snapshotNow("milestone", "before-join"), [getVersionScheduler]);
  const collab = useCollabSession({ scene: runtime?.scene ?? null, pageStore, apiBaseUrl: shareApiBaseUrl, onBeforeJoin: snapshotBeforeJoin });

  /**
   * Version history. Built after `useCollabSession` because its restore guard reads that session's
   * state — the one thing restore is not allowed to do is replace the document out from under a room.
   *
   * `sessionActive` is the rendered value, for the panel's disabled-and-explained button.
   * `isSessionActive` is the same fact read without waiting for a render, which is what the guard
   * inside `restore-version-snapshot.ts` gets: `collab.isJoining()` is written synchronously before
   * the connect is awaited, so a guard built on it cannot be blind during the connect window.
   */
  const sessionActive = collab.status !== "disconnected" || collab.joining;
  const getSessionConnected = useStableGetter(collab.status !== "disconnected");
  const isSessionActive = useCallback(() => getSessionConnected() || collab.isJoining(), [getSessionConnected, collab]);
  const versionHistory = useVersionHistory({
    open: versionHistoryOpen.value,
    getVersionStore,
    getVersionScheduler,
    getFileStore,
    collectUnusedFiles,
    pageStore,
    isSessionActive,
    // A restored document's images are read back after the swap, and bringing stored bytes into a
    // scene deliberately does not notify — so the frame has to be asked for.
    onRestored: repaint,
  });
  /**
   * Joining a room is opening a document, not merging one.
   *
   * Merging was the old behaviour and it was wrong in a way that mattered: a peer that had drawn
   * anything kept its own pages, and the page manifest then published that work — every page, every
   * element — into the room it had just joined. Somebody's unsaved board went to everyone there.
   *
   * So the room's board replaces what is open, after the host has had its chance to ask about
   * unsaved work. Blanking first also means the joiner arrives as an untouched client, which is
   * exactly the state page adoption is built for.
   *
   * Starting a session is deliberately NOT this: sharing the board you already have is the whole
   * point of hosting one.
   */
  const joinRoom = useCallback(
    async (url: string) => {
      if (confirmDiscardChanges && !(await confirmDiscardChanges())) return;
      handle?.newDocument();
      await collab.joinSession(url);
    },
    [confirmDiscardChanges, handle, collab],
  );

  // Hosting is a peer of the session, not a mode of it: it must survive the dialog closing, and it is
  // the one collaboration path that works with no `shareApiBaseUrl` and no internet at all.
  const hosting = useLanHosting({ lanHost, hostSession: collab.hostSession, leaveSession: collab.leaveSession });
  useEffect(() => {
    // Only cursors on the locally-active page reach the canvas — a peer's `pageId` is `undefined`
    // when they run a pre-pages build, which renders everywhere rather than nowhere.
    const activePageId = pageStore.getActivePageId();
    remoteCursorsRef.current = collab.peers
      .filter((peer) => peer.pageId === undefined || peer.pageId === activePageId)
      .filter((peer): peer is typeof peer & { point: { x: number; y: number } } => peer.point !== null)
      .map((peer) => ({ id: peer.peerId, name: peer.name, color: peer.color, point: peer.point }));
    // `runtime` stands in for "the active page changed" — the runtime rebuilds on every page switch,
    // so this refilter runs then too, not only when the peer list itself changes.
  }, [collab.peers, pageStore, runtime]);
  useCollabCursorTracking({ containerRef: canvasHostRef, getCamera, onCursorMove: collab.updateCursor, active: collab.status === "connected" });

  // Follow mode's two halves: publish this client's view for peers who follow it, and drive the local
  // camera from whoever this client follows. Any local camera gesture breaks the follow (`onBreak`) —
  // that rule lives in the hook, not in the pan/zoom handlers; see `use-follow-peer-camera.ts`.
  const collabFollow = collab.follow;
  usePublishLocalViewport({ cameraStore, getViewportSize, publish: collab.setLocalViewport, active: collab.status === "connected" });
  const stopFollowing = useCallback(() => collabFollow(null), [collabFollow]);
  useFollowPeerCamera({ cameraStore, getViewportSize, viewport: collab.followedViewport, onBreak: stopFollowing });
  const followedPeer = collab.peers.find((peer) => peer.peerId === collab.followedPeerId) ?? null;

  const collabRole = collab.role;
  const setCollabViewer = collabViewer.set;
  useEffect(() => {
    setCollabViewer(collabRole === "viewer");
  }, [collabRole, setCollabViewer]);

  // Zen mode hides the *panel*-class chrome only — the side/edge surfaces that crowd the drawing
  // area (properties, pages, library, minimap, layers, hints, empty state). The toolbar, top bar and
  // the two floating pills stay, so the mode never becomes a trap: whatever the user reaches for
  // next (a tool, undo, zoom, the menu, the exit pill) is still on screen. Hiding *everything* left
  // no affordance at all, keyboard-only or otherwise.


  // Auto-join a room link exactly once, after the runtime (and thus the scene the session syncs into)
  // exists. Guarded so a re-render or a status change never re-triggers the join mid-session.
  const autoJoinedRef = useRef(false);
  const joinSession = collab.joinSession;
  useEffect(() => {
    if (!initialRoomUrl || !runtime || autoJoinedRef.current) return;
    autoJoinedRef.current = true;
    // Page adoption is `joinSession`'s own job (see `use-collab-session.ts`) — it has to happen for
    // every join, not only the ones a room URL starts, so it does not live here.
    void joinSession(initialRoomUrl);
  }, [initialRoomUrl, runtime, joinSession]);

  return (
    <div
      className={className}
      data-testid="deviva-draw-root"
      // The tablet tier (`useLayoutTier`): desktop layout, touch-sized targets. The injected
      // chrome stylesheet keys density overrides on this attribute, so no component branches itself.
      data-dd-density={layoutTier === "tablet" ? "touch" : undefined}
      // `colorScheme` is what makes the browser's OWN widgets — checkboxes, selects, the text caret —
      // follow the app's theme rather than the page's. Without it a dark chrome still renders bright
      // white checkbox squares, which is exactly where the theme used to visibly break.
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", colorScheme: mode, ...cssVariables, ...style }}
    >
      <div ref={canvasHostRef} data-testid="deviva-draw-canvas-host" style={{ position: "absolute", inset: 0, background: canvasBackground ?? "var(--dd-canvas-background)" }}>
        {runtime && <EmbedOverlay runtime={runtime} cameraStore={cameraStore} />}
        {runtime && editSession && (
          <TextEditorOverlay
            session={editSession}
            scene={runtime.scene}
            getCamera={getCamera}
            subscribeCamera={cameraStore.subscribe}
            keyboardInsetPx={keyboardInsetPx}
            setCamera={cameraStore.setCamera}
            getViewportHeight={() => canvasHostRef.current?.clientHeight ?? 0}
          />
        )}
      </div>
      {runtime && !presentationViewOnly && (isNarrow ? <BottomToolbar runtime={runtime} onInsertImage={openImagePicker} /> : <Toolbar runtime={runtime} toolLocked={toolLock.value} onToggleLock={() => toolLock.set(!toolLock.value)} onInsertImage={openImagePicker} />)}
      {runtime && !panelsHidden && !isNarrow && <CanvasHint runtime={runtime} editSession={editSession} />}
      {runtime && !panelsHidden && <EmptyStateOverlay runtime={runtime} editSession={editSession} />}
      {runtime && !presentationActive.value && <TopBar runtime={runtime} cameraStore={cameraStore} onOpenMainMenu={() => mainMenuOpen.set(true)} compact={layoutTier === "tablet"} />}
      {/* Tablet tier: the compact top bar's history/zoom controls live bottom-left instead (see TopBarProps.compact), keeping the centered toolbar's whole top row free. */}
      {runtime && !presentationActive.value && layoutTier === "tablet" && <TabletBottomControls runtime={runtime} cameraStore={cameraStore} />}
      {/* `readOnly` takes the derived flag, not the raw toggle: a collaboration viewer must not be able
          to add or delete pages either. Their page edits would never reach the room (the relay drops a
          viewer's snapshots, which is what carries the page manifest), so allowing them locally would
          silently fork the document out from under them. */}
      {runtime && !panelsHidden && !isNarrow && (
        <PagesPanel pageStore={pageStore} readOnly={presentationViewOnly} onSwitchPage={(id) => parkCameraThen(() => pageStore.setActivePage(id))} onAddPage={() => parkCameraThen(() => pageStore.addPage())} />
      )}
      {runtime && !panelsHidden && <LibraryToggle open={libraryOpen.value} onToggle={() => libraryOpen.set(!libraryOpen.value)} />}
      {runtime && !panelsHidden && propertiesPanelVisible.value && !presentationViewOnly && (isNarrow ? <MobilePropertiesBar runtime={runtime} /> : <PropertiesPanel runtime={runtime} />)}
      {runtime && !presentationActive.value && (
        <BackToContentPill runtime={runtime} cameraStore={cameraStore} getViewportSize={() => ({ width: canvasHostRef.current?.clientWidth ?? 0, height: canvasHostRef.current?.clientHeight ?? 0 })} />
      )}
      {runtime && zenMode.value && !presentationActive.value && <ExitZenPill onExit={() => zenMode.set(false)} />}
      {/* Presenting drives the camera itself, which would break the follow on the first slide anyway —
          so the pill is not rendered there rather than flashing on screen for one frame. */}
      {runtime && followedPeer && !presentationActive.value && <FollowingPeerPill peerName={followedPeer.name} peerColor={followedPeer.color} onStop={stopFollowing} />}
      {runtime && collabViewer.value && !presentationActive.value && <CollabViewerBadge />}
      {/* Not gated on `panelsHidden`: zen mode hides chrome the user chose to do without, and nobody
          chooses to do without being told their work has stopped saving. Presentation is the one
          exception — the audience is looking at the board, and the presenter's own copy is unharmed. */}
      {/* One band, one stack — see `top-banner-stack.tsx` for why these no longer place themselves. */}
      <TopBannerStack>
        {runtime && !presentationActive.value && <AutosaveQuotaBanner status={autosaveStatus} onSave={() => void runtime.actionRegistry.run("save-scene", runtime)} />}
        {/* Rendered here rather than beside the dialog: a session usually ends while the dialog is
            closed, and a notice nobody can see is not a notice. */}
        {collab.endedReason !== null && <SessionEndedNotice reason={collab.endedReason} onDismiss={collab.dismissEnded} />}
        {imageInsertOutcome !== null && <ImageInsertNotice outcome={imageInsertOutcome} onDismiss={clearImageInsertOutcome} />}
      </TopBannerStack>
      {runtime && presentationActive.value && (
        <PresentationController
          runtime={runtime}
          cameraStore={cameraStore}
          getViewportSize={() => ({ width: canvasHostRef.current?.clientWidth ?? 0, height: canvasHostRef.current?.clientHeight ?? 0 })}
          onExit={() => presentationActive.set(false)}
          collab={collab}
        />
      )}
      {runtime && !panelsHidden && !isNarrow && minimapVisible.value && (
        <Minimap runtime={runtime} cameraStore={cameraStore} getViewportSize={() => ({ width: canvasHostRef.current?.clientWidth ?? 0, height: canvasHostRef.current?.clientHeight ?? 0 })} />
      )}
      {runtime && mainMenuOpen.value && (
        <MainMenu
          runtime={runtime}
          onClose={() => mainMenuOpen.set(false)}
          onOpenShortcuts={() => shortcutsDialogOpen.set(true)}
          onOpenCollab={() => collabDialogOpen.set(true)}
          onOpenExport={() => exportDialogOpen.set(true)}
          onOpenLibrary={() => libraryOpen.set(true)}
          onOpenVersionHistory={() => versionHistoryOpen.set(true)}
          onOpenMermaid={() => mermaidOpen.set(true)}
          onOpenEmbed={() => embedOpen.set(true)}
          shareEnabled={Boolean(shareApiBaseUrl)}
        />
      )}
      {runtime && embedOpen.value && (
        <EmbedDialog
          runtime={runtime}
          cameraStore={cameraStore}
          getViewportSize={() => ({ width: canvasHostRef.current?.clientWidth ?? 0, height: canvasHostRef.current?.clientHeight ?? 0 })}
          onClose={() => embedOpen.set(false)}
        />
      )}
      {runtime && mermaidOpen.value && (
        <MermaidDialog
          runtime={runtime}
          cameraStore={cameraStore}
          getViewportSize={() => ({ width: canvasHostRef.current?.clientWidth ?? 0, height: canvasHostRef.current?.clientHeight ?? 0 })}
          onClose={() => mermaidOpen.set(false)}
        />
      )}
      {runtime && exportDialogOpen.value && <ExportDialog runtime={runtime} onClose={() => exportDialogOpen.set(false)} />}
      {runtime && libraryOpen.value && (
        <LibraryPanel
          runtime={runtime}
          cameraStore={cameraStore}
          getViewportSize={() => ({ width: canvasHostRef.current?.clientWidth ?? 0, height: canvasHostRef.current?.clientHeight ?? 0 })}
          onClose={() => libraryOpen.set(false)}
        />
      )}
      {runtime && versionHistoryOpen.value && <VersionHistoryPanel history={versionHistory} sessionActive={sessionActive} onClose={() => versionHistoryOpen.set(false)} />}
      {runtime && shortcutsDialogOpen.value && <ShortcutsDialog runtime={runtime} onClose={() => shortcutsDialogOpen.set(false)} />}
      {runtime && findOpen.value && (
        <FindPanel runtime={runtime} pageStore={pageStore} onSwitchPage={(id) => parkCameraThen(() => pageStore.setActivePage(id))} onClose={() => findOpen.set(false)} />
      )}
      {runtime && shareDialog.value.status !== "closed" && (
        <ShareDialog
          state={shareDialog.value}
          apiBaseUrl={shareApiBaseUrl}
          onRegenerate={(expiresAt) => void runShareScene(runtime, expiresAt)}
          onClose={() => shareDialog.set({ status: "closed" })}
          onStartCollab={() => {
            shareDialog.set({ status: "closed" });
            collabDialogOpen.set(true);
          }}
        />
      )}
      {runtime && initialViewOnly && !panelsHidden && (
        <ShareViewerBadge viewOnly={viewOnly.value} onEditCopy={() => void runtime.actionRegistry.run("toggle-view-only", runtime)} />
      )}
      {runtime && collabDialogOpen.value && <CollabDialog collab={collab} hosting={hosting} onJoin={joinRoom} onClose={() => collabDialogOpen.set(false)} />}
      {runtime && commandPaletteOpen.value && <CommandPalette runtime={runtime} onClose={() => commandPaletteOpen.set(false)} />}
      {pendingPlacement && <ImagePlacementOverlay placement={pendingPlacement} getCamera={getCamera} />}
      {runtime && <LinkBadgesOverlay scene={runtime.scene} cameraStore={cameraStore} />}
      {runtime && !presentationViewOnly && <ImageCropOverlay runtime={runtime} cameraStore={cameraStore} />}
      {runtime && !presentationViewOnly && <TableCellEditorOverlay runtime={runtime} cameraStore={cameraStore} keyboardInsetPx={keyboardInsetPx} />}
      {runtime && contextMenuTriggers.point && !presentationViewOnly && (
        <ContextMenu runtime={runtime} screenPoint={contextMenuTriggers.point} variant={contextMenuTriggers.variant} onClose={contextMenuTriggers.close} />
      )}
      {statsPanel.value && runtime && !presentationViewOnly && <StatsPanel runtime={runtime} cameraStore={cameraStore} />}
      {layersPanel.value && runtime && !panelsHidden && !isNarrow && !presentationViewOnly && <LayersPanel runtime={runtime} />}
      {/* `panelsHidden` covers both: an audience is not looking at review notes, and zen mode is a
          deliberate "hide the annotations too" working mode. Still rendered in view-only, though —
          reading a conversation is not editing the document (the popover's own `readOnly` handles that). */}
      {runtime && !panelsHidden && (
        <CommentsCanvasLayer
          scene={runtime.scene}
          cameraStore={cameraStore}
          openThreadId={openCommentThreadId.value}
          onOpenThread={openCommentThreadId.set}
          readOnly={presentationViewOnly}
        />
      )}
      {commentsPanel.value && runtime && !panelsHidden && !isNarrow && (
        <CommentsPanel runtime={runtime} onOpenThread={(threadId) => openCommentThreadId.set(threadId)} />
      )}
    </div>
  );
});
