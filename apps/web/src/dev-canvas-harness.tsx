import { useCallback, useEffect, useRef, useState } from "react";
import {
  CanvasStage,
  createCamera,
  createDiamondElement,
  createEllipseElement,
  createRectangleElement,
  getVisibleElements,
  Scene,
} from "@deviva-draw/engine";
import type { AnyElement, Camera, TextEditSession } from "@deviva-draw/engine";
import { TextEditorOverlay, usePasteAndDrop } from "@deviva-draw/react";
import { decodeNaturalSize } from "./browser-image-decode";
import {
  copySceneImageToClipboard,
  exportSceneToPngFile,
  exportSceneToSvgFile,
  openSceneFromFile,
  restoreBrowserAutosave,
  saveSceneToFile,
  startBrowserAutosave,
} from "./dev-canvas-harness-persistence";
import type { DevCanvasHarnessRuntime } from "./dev-canvas-harness-runtime";
import { createDevCanvasHarnessRuntime } from "./dev-canvas-harness-runtime";
import { SELECT_TOOL_NAME } from "./dev-canvas-harness-tool-names";

const SEEDED_ELEMENT_COUNT = 500;
const SEED_SPREAD = 4000;
const DEBUG_POLL_MS = 250;
/** "Export PNG at 2x" is this phase's explicit success criterion — the manual QA button below defaults to it. */
const EXPORT_PNG_SCALE = 2;

/**
 * Scatters `SEEDED_ELEMENT_COUNT` fake shapes (mixed rectangle/ellipse/diamond) across a large
 * scene area — exercises the rough.js renderer, pan/zoom, and culling all at once as a manual perf
 * smoke check ("no console errors drawing 200+ mixed shapes at once").
 */
function seedScene(scene: Scene): void {
  const factories = [createRectangleElement, createEllipseElement, createDiamondElement] as const;
  for (let i = 0; i < SEEDED_ELEMENT_COUNT; i += 1) {
    // `factories` is a fixed non-empty tuple indexed by `i % factories.length`, always in range.
    const factory = factories[i % factories.length]!;
    scene.addElement(
      factory({
        x: Math.random() * SEED_SPREAD - SEED_SPREAD / 2,
        y: Math.random() * SEED_SPREAD - SEED_SPREAD / 2,
        width: 20 + Math.random() * 60,
        height: 20 + Math.random() * 60,
        strokeColor: `hsl(${Math.floor(Math.random() * 360)}, 70%, 45%)`,
        backgroundColor: `hsl(${Math.floor(Math.random() * 360)}, 70%, 85%)`,
        fillStyle: "hachure",
      }),
    );
  }
}

/**
 * Manual test page wiring `CanvasStage` and the real input pipeline into the Vite app: the real
 * select tool (`1` or `V`) is active by default — click/shift-click/rubber-band-marquee to select,
 * drag to move (alt-drag to duplicate), 8 handles to resize (shift = aspect lock, alt = from-center),
 * the handle above the selection to rotate (shift = 15deg steps), Delete to remove, Ctrl/Cmd+D to
 * duplicate, Ctrl/Cmd+C/V to copy/paste, Ctrl/Cmd+A to select all, Ctrl/Cmd+G / +Shift+G to
 * group/ungroup, `]`/`[` (+Ctrl/Cmd for front/back) for z-order, arrow keys to nudge, Escape to clear
 * — `H` (or space/middle-mouse-drag) pans, `R`/`O`/`D`/`L` switch to the rectangle/ellipse/diamond/line
 * shape tools, `P` switches to the freehand ink tool, `T` switches to the text tool, `A` switches to
 * the arrow tool, double-click inside a rect/ellipse/diamond or on an arrow edits its bound label,
 * wheel pans/ctrl+wheel zooms (cursor-anchored), `Shift+1` zooms to fit, `Ctrl +`/`Ctrl -` step zoom
 * — all driven by `@deviva-draw/engine`'s `PointerEventPipeline`/`ToolStateMachine`/`SelectionTool`
 * (tool/pipeline construction lives in `dev-canvas-harness-runtime.ts`, split out to keep this
 * component small). A debug overlay reports element/selection counts and the active tool, and buttons
 * toggle grid mode and exercise persistence/export (`dev-canvas-harness-persistence.ts`) for manual QA:
 * localStorage autosave starts automatically and restores on boot; Save/Open round-trip a `.devivadraw`
 * JSON file; Export PNG/SVG trigger a download of the live scene.
 */
export function DevCanvasHarness() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Lazy-initialized once, on first render: restores the last autosaved scene if one exists, so
  // reloading the tab picks up exactly where the previous session left off (this phase's own
  // "reload the browser tab — scene restores exactly from localStorage" success criterion).
  const sceneRef = useRef<Scene | null>(null);
  if (sceneRef.current === null) sceneRef.current = restoreBrowserAutosave() ?? new Scene();
  const cameraRef = useRef<Camera>(createCamera());
  const runtimeRef = useRef<DevCanvasHarnessRuntime | null>(null);
  const [debugCounts, setDebugCounts] = useState({ total: 0, visible: 0, activeTool: SELECT_TOOL_NAME, selected: 0, gridEnabled: false });
  // Set once the effect below constructs the runtime — the overlay only renders once this exists;
  // a ref alone wouldn't trigger the re-render needed to mount it.
  const [editSession, setEditSession] = useState<TextEditSession | null>(null);
  // Bumped by "Open" to force the mount effect below to tear down and rebuild CanvasStage/the tool
  // runtime/autosave against the newly-loaded `Scene` instance held in `sceneRef.current` — a plain
  // ref reassignment alone wouldn't retrigger the effect, since its dependency array is what React
  // actually watches, not the ref's mutable `.current` box.
  const [sceneVersion, setSceneVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  // Stable (never-changing) accessors — `usePasteAndDrop`'s effect re-attaches its DOM listeners
  // whenever these identities change, so wrapping the refs in `useCallback` (empty deps) instead of
  // passing fresh inline closures avoids tearing down/re-adding the paste/drop listeners every render.
  const getCamera = useCallback(() => cameraRef.current, []);
  const getViewportSize = useCallback(
    () => ({ width: containerRef.current?.clientWidth ?? 0, height: containerRef.current?.clientHeight ?? 0 }),
    [],
  );
  const onInsertError = useCallback((error: unknown) => console.warn("dev-canvas-harness: image insert rejected", error), []);

  // Paste (clipboard image or SVG markup) and drag-drop insertion — the scene's own `subscribe`
  // callback below (invalidating the static layer) already covers redrawing once an image lands, so
  // no extra wiring is needed here beyond the hook call itself. Reads `sceneRef.current` directly
  // (not `sceneVersion`) since a scene swap via "Open" always accompanies a `sceneVersion` bump, which
  // re-renders this component and re-evaluates this hook call against the now-current ref value.
  usePasteAndDrop({
    containerRef,
    scene: sceneRef.current,
    getCamera,
    getViewportSize,
    decodeNaturalSize,
    onInsertError,
  });

  useEffect(() => {
    const container = containerRef.current;
    const scene = sceneRef.current;
    if (!container || !scene) return;

    if (scene.getElements().length === 0) seedScene(scene);

    const stage = new CanvasStage();
    stage.mount(container);
    const unsubscribe = scene.subscribe(() => stage.staticLayer.invalidate());
    const autosave = startBrowserAutosave(scene);

    const runtime = createDevCanvasHarnessRuntime(
      container,
      scene,
      () => cameraRef.current,
      (camera) => {
        cameraRef.current = camera;
      },
    );
    runtimeRef.current = runtime;
    setEditSession(runtime.editSession);

    let frameHandle = requestAnimationFrame(function renderFrame() {
      stage.staticLayer.render(scene, cameraRef.current, runtime.grid);
      const selectedElements = [...runtime.selectionState.getSelectedIds()]
        .map((id) => scene.getElement(id))
        .filter((element): element is AnyElement => !!element);
      stage.interactiveLayer.render(
        { selectedElements, marqueeRect: runtime.getMarqueeRect(), snapGuides: runtime.getSnapGuides() },
        cameraRef.current,
      );
      frameHandle = requestAnimationFrame(renderFrame);
    });

    const debugInterval = window.setInterval(() => {
      const viewportSize = { width: container.clientWidth, height: container.clientHeight };
      setDebugCounts({
        total: scene.getElements().length,
        visible: getVisibleElements(scene, cameraRef.current, viewportSize).length,
        activeTool: runtime.toolStateMachine.getActiveToolName(),
        selected: runtime.selectionState.size,
        gridEnabled: runtime.grid.enabled,
      });
    }, DEBUG_POLL_MS);

    return () => {
      cancelAnimationFrame(frameHandle);
      window.clearInterval(debugInterval);
      unsubscribe();
      autosave.dispose();
      runtime.dispose();
      runtimeRef.current = null;
      stage.unmount();
      setEditSession(null);
    };
  }, [sceneVersion]);

  const toggleGrid = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.grid.enabled = !runtime.grid.enabled;
    setDebugCounts((previous) => ({ ...previous, gridEnabled: runtime.grid.enabled }));
  }, []);

  const handleSave = useCallback(() => {
    if (!sceneRef.current) return;
    saveSceneToFile(sceneRef.current).catch((error) => console.error("dev-canvas-harness: save failed", error));
  }, []);

  const handleOpen = useCallback(() => {
    setBusy(true);
    openSceneFromFile()
      .then((opened) => {
        if (!opened) return;
        sceneRef.current = opened;
        cameraRef.current = createCamera();
        setSceneVersion((version) => version + 1);
      })
      .catch((error) => console.error("dev-canvas-harness: open failed", error))
      .finally(() => setBusy(false));
  }, []);

  const handleExportPng = useCallback(() => {
    if (!sceneRef.current) return;
    exportSceneToPngFile(sceneRef.current, EXPORT_PNG_SCALE).catch((error) => console.error("dev-canvas-harness: PNG export failed", error));
  }, []);

  const handleExportSvg = useCallback(() => {
    if (!sceneRef.current) return;
    exportSceneToSvgFile(sceneRef.current).catch((error) => console.error("dev-canvas-harness: SVG export failed", error));
  }, []);

  const handleCopyImage = useCallback(() => {
    if (!sceneRef.current) return;
    copySceneImageToClipboard(sceneRef.current).catch((error) => console.error("dev-canvas-harness: copy-as-image failed", error));
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        data-testid="dev-canvas-container"
        style={{ position: "relative", width: "100%", height: "70vh", border: "1px solid #ccc" }}
      >
        {editSession && <TextEditorOverlay session={editSession} scene={sceneRef.current!} getCamera={() => cameraRef.current} />}
      </div>
      <p data-testid="dev-canvas-debug-counts">
        elements: {debugCounts.total} total / {debugCounts.visible} visible (culled:{" "}
        {debugCounts.total - debugCounts.visible}) / tool: {debugCounts.activeTool} / selected: {debugCounts.selected}
      </p>
      <button type="button" data-testid="dev-canvas-grid-toggle" onClick={toggleGrid}>
        grid: {debugCounts.gridEnabled ? "on" : "off"}
      </button>
      <button type="button" data-testid="dev-canvas-save" onClick={handleSave}>
        save .devivadraw
      </button>
      <button type="button" data-testid="dev-canvas-open" onClick={handleOpen} disabled={busy}>
        open .devivadraw
      </button>
      <button type="button" data-testid="dev-canvas-export-png" onClick={handleExportPng}>
        export PNG ({EXPORT_PNG_SCALE}x)
      </button>
      <button type="button" data-testid="dev-canvas-export-svg" onClick={handleExportSvg}>
        export SVG
      </button>
      <button type="button" data-testid="dev-canvas-copy-image" onClick={handleCopyImage}>
        copy as image
      </button>
    </div>
  );
}
