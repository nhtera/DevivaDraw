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
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { createCamera } from "@deviva-draw/engine";
import type { RemoteCursorOverlay } from "@deviva-draw/engine";
import { usePasteAndDrop } from "./hooks/use-paste-and-drop";
import { useCollabCursorTracking } from "./hooks/use-collab-cursor-tracking";
import { useCollabSession } from "./hooks/use-collab-session";
import { TextEditorOverlay } from "./components/text-editor-overlay";
import { Toolbar } from "./components/toolbar";
import { TopBar } from "./components/top-bar";
import { PropertiesPanel } from "./components/properties-panel";
import { ContextMenu } from "./components/context-menu";
import { MainMenu } from "./components/main-menu";
import { ShareDialog } from "./components/share-dialog";
import { CollabDialog } from "./components/collab-dialog";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { CommandPalette } from "./components/command-palette";
import { BottomToolbar } from "./components/mobile/bottom-toolbar";
import { useIsNarrowViewport } from "./components/responsive-layout";
import { useTranslation } from "./i18n/use-translation";
import { useTheme } from "./theme/theme-provider";
import { decodeNaturalSize } from "./browser/browser-image-decode";
import { createCameraStore } from "./runtime/camera-store";
import { useApplyThemeSwap } from "./runtime/use-apply-theme-swap";
import { useContextMenuTriggers } from "./runtime/use-context-menu-triggers";
import { useStableCallback, useStableGetter } from "./runtime/use-stable-ref";
import { useDevivaRuntime } from "./runtime/use-deviva-runtime";
import { useToggleState } from "./runtime/use-toggle-state";
import { useValueState } from "./runtime/use-value-state";
import { NOOP_HANDLE } from "./runtime/noop-handle";
import type { DevivaDrawHandle } from "./runtime/imperative-handle";
import type { ShareDialogState } from "./actions/action-types";
import type { DevivaDrawProps } from "./deviva-draw-app-types";

export const DevivaDrawShell = forwardRef<DevivaDrawHandle, DevivaDrawProps>(function DevivaDrawShell(props, ref) {
  const { initialData, onChange, className, style, initialViewOnly, shareApiBaseUrl } = props;
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();
  const { mode, tokens, cssVariables, toggleMode } = useTheme();
  const isNarrow = useIsNarrowViewport();

  // Owned here (not by `useDevivaRuntime`) so `useContextMenuTriggers` below — which needs a live
  // `CameraStore` to feed its `TouchGestureAdapter` — can be constructed *before* the runtime exists;
  // see `use-deviva-runtime.ts`'s `cameraStore` option doc.
  const cameraStoreRef = useRef<ReturnType<typeof createCameraStore> | null>(null);
  cameraStoreRef.current ??= createCameraStore(createCamera());
  const cameraStore = cameraStoreRef.current;

  const zenMode = useToggleState(false);
  const viewOnly = useToggleState(initialViewOnly ?? false);
  const statsPanel = useToggleState(false);
  const commandPaletteOpen = useToggleState(false);
  const shortcutsDialogOpen = useToggleState(false);
  const mainMenuOpen = useToggleState(false);
  const shareDialog = useValueState<ShareDialogState>({ status: "closed" });
  const collabDialogOpen = useToggleState(false);
  const contextMenuTriggers = useContextMenuTriggers(canvasHostRef, cameraStore);

  // `use-deviva-runtime.ts`'s mount effect only re-runs on an explicit scene swap ("Open"), so it
  // freezes whatever `getThemeMode`/`toggleThemeMode`/`isChromeOverlayOpen` it received at that
  // moment — these stay a stable identity forever while always delegating to the *current* render's
  // actual value (review fix: dialog-open keydown leak + stale-onChange closure).
  const getThemeMode = useStableGetter(mode);
  const toggleThemeMode = useStableCallback(toggleMode);
  const isChromeOverlayOpen = useStableGetter(
    commandPaletteOpen.value ||
      shortcutsDialogOpen.value ||
      mainMenuOpen.value ||
      shareDialog.value.status !== "closed" ||
      collabDialogOpen.value ||
      contextMenuTriggers.point !== null,
  );

  // Read by the render loop every frame (see `start-render-loop.ts`'s `getRemoteCursors` doc); kept as
  // a ref + a `useCallback([])`-stable getter, not a value derived from `useCollabSession`'s state
  // directly, precisely so it can be handed to `useDevivaRuntime` below *before* `useCollabSession` is
  // even called (that hook needs `runtime.scene`, which doesn't exist until after this call) without
  // either hook depending on the other's call order.
  const remoteCursorsRef = useRef<RemoteCursorOverlay[]>([]);
  const getRemoteCursors = useCallback(() => remoteCursorsRef.current, []);

  const { runtime, editSession, handle } = useDevivaRuntime({
    containerRef: canvasHostRef,
    cameraStore,
    initialData,
    onChange,
    ui: {
      getZenMode: zenMode.get,
      setZenMode: zenMode.set,
      getViewOnly: viewOnly.get,
      setViewOnly: viewOnly.set,
      getStatsPanelVisible: statsPanel.get,
      setStatsPanelVisible: statsPanel.set,
      getCommandPaletteOpen: commandPaletteOpen.get,
      setCommandPaletteOpen: commandPaletteOpen.set,
      getShortcutsDialogOpen: shortcutsDialogOpen.get,
      setShortcutsDialogOpen: shortcutsDialogOpen.set,
      getShareDialogState: shareDialog.get,
      setShareDialogState: shareDialog.set,
    },
    shareApiBaseUrl,
    getThemeMode,
    toggleThemeMode,
    isChromeOverlayOpen,
    getRemoteCursors,
  });

  useImperativeHandle(ref, () => handle ?? NOOP_HANDLE, [handle]);
  useApplyThemeSwap(runtime, mode);

  const getCamera = useCallback(() => cameraStore.getCamera(), [cameraStore]);
  const getViewportSize = useCallback(
    () => ({ width: canvasHostRef.current?.clientWidth ?? 0, height: canvasHostRef.current?.clientHeight ?? 0 }),
    [],
  );
  usePasteAndDrop({
    containerRef: canvasHostRef,
    scene: runtime?.scene ?? null,
    getCamera,
    getViewportSize,
    decodeNaturalSize,
    onInsertError: (error) => console.warn("deviva-draw: image insert rejected", error),
  });

  // Collaboration is opt-in and reuses the same collab-server base URL the "Share" action already
  // requires (`shareApiBaseUrl` — both are that Worker's endpoints, see `use-collab-session.ts`'s
  // `apiBaseUrl` doc) rather than introducing a second, near-identical prop.
  const collab = useCollabSession({ scene: runtime?.scene ?? null, apiBaseUrl: shareApiBaseUrl });
  useEffect(() => {
    remoteCursorsRef.current = collab.peers
      .filter((peer): peer is typeof peer & { point: { x: number; y: number } } => peer.point !== null)
      .map((peer) => ({ id: peer.peerId, name: peer.name, color: peer.color, point: peer.point }));
  }, [collab.peers]);
  useCollabCursorTracking({ containerRef: canvasHostRef, getCamera, onCursorMove: collab.updateCursor, active: collab.status === "connected" });

  return (
    <div
      className={className}
      data-testid="deviva-draw-root"
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...cssVariables, ...style }}
    >
      <div ref={canvasHostRef} data-testid="deviva-draw-canvas-host" style={{ position: "absolute", inset: 0 }}>
        {runtime && editSession && (
          <TextEditorOverlay session={editSession} scene={runtime.scene} getCamera={getCamera} subscribeCamera={cameraStore.subscribe} canvasBackgroundColor={tokens.canvasBackground} />
        )}
      </div>
      {runtime && !zenMode.value && (isNarrow ? <BottomToolbar runtime={runtime} /> : <Toolbar runtime={runtime} />)}
      {runtime && !zenMode.value && <TopBar runtime={runtime} cameraStore={cameraStore} onOpenMainMenu={() => mainMenuOpen.set(true)} />}
      {runtime && !zenMode.value && !viewOnly.value && <PropertiesPanel runtime={runtime} />}
      {runtime && mainMenuOpen.value && (
        <MainMenu
          runtime={runtime}
          onClose={() => mainMenuOpen.set(false)}
          onOpenShortcuts={() => shortcutsDialogOpen.set(true)}
          onOpenCollab={() => collabDialogOpen.set(true)}
        />
      )}
      {runtime && shortcutsDialogOpen.value && <ShortcutsDialog runtime={runtime} onClose={() => shortcutsDialogOpen.set(false)} />}
      {runtime && shareDialog.value.status !== "closed" && <ShareDialog state={shareDialog.value} onClose={() => shareDialog.set({ status: "closed" })} />}
      {runtime && collabDialogOpen.value && <CollabDialog collab={collab} onClose={() => collabDialogOpen.set(false)} />}
      {runtime && commandPaletteOpen.value && <CommandPalette runtime={runtime} onClose={() => commandPaletteOpen.set(false)} />}
      {runtime && contextMenuTriggers.point && !viewOnly.value && (
        <ContextMenu runtime={runtime} screenPoint={contextMenuTriggers.point} onClose={contextMenuTriggers.close} />
      )}
      {statsPanel.value && runtime && (
        <div data-testid="stats-panel" style={{ position: "absolute", bottom: 8, right: 8, fontSize: 11, color: "var(--dd-text-secondary)" }}>
          {t("panel.layers")}: {runtime.scene.getElements().filter((element) => !element.isDeleted).length}
        </div>
      )}
    </div>
  );
});
