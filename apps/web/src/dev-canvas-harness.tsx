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
import type { DevCanvasHarnessRuntime } from "./dev-canvas-harness-runtime";
import { createDevCanvasHarnessRuntime } from "./dev-canvas-harness-runtime";
import { SELECT_TOOL_NAME } from "./dev-canvas-harness-tool-names";

const SEEDED_ELEMENT_COUNT = 500;
const SEED_SPREAD = 4000;
const DEBUG_POLL_MS = 250;

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
 * component small). A debug overlay reports element/selection counts and the active tool, and a
 * button toggles grid mode, for manual QA.
 */
export function DevCanvasHarness() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene>(new Scene());
  const cameraRef = useRef<Camera>(createCamera());
  const runtimeRef = useRef<DevCanvasHarnessRuntime | null>(null);
  const [debugCounts, setDebugCounts] = useState({ total: 0, visible: 0, activeTool: SELECT_TOOL_NAME, selected: 0, gridEnabled: false });
  // Set once the effect below constructs the runtime — the overlay only renders once this exists;
  // a ref alone wouldn't trigger the re-render needed to mount it.
  const [editSession, setEditSession] = useState<TextEditSession | null>(null);

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
  // no extra wiring is needed here beyond the hook call itself.
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
    if (!container) return;

    if (sceneRef.current.getElements().length === 0) seedScene(sceneRef.current);

    const stage = new CanvasStage();
    stage.mount(container);
    const unsubscribe = sceneRef.current.subscribe(() => stage.staticLayer.invalidate());

    const runtime = createDevCanvasHarnessRuntime(
      container,
      sceneRef.current,
      () => cameraRef.current,
      (camera) => {
        cameraRef.current = camera;
      },
    );
    runtimeRef.current = runtime;
    setEditSession(runtime.editSession);

    let frameHandle = requestAnimationFrame(function renderFrame() {
      stage.staticLayer.render(sceneRef.current, cameraRef.current, runtime.grid);
      const selectedElements = [...runtime.selectionState.getSelectedIds()]
        .map((id) => sceneRef.current.getElement(id))
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
        total: sceneRef.current.getElements().length,
        visible: getVisibleElements(sceneRef.current, cameraRef.current, viewportSize).length,
        activeTool: runtime.toolStateMachine.getActiveToolName(),
        selected: runtime.selectionState.size,
        gridEnabled: runtime.grid.enabled,
      });
    }, DEBUG_POLL_MS);

    return () => {
      cancelAnimationFrame(frameHandle);
      window.clearInterval(debugInterval);
      unsubscribe();
      runtime.dispose();
      runtimeRef.current = null;
      stage.unmount();
      setEditSession(null);
    };
  }, []);

  const toggleGrid = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.grid.enabled = !runtime.grid.enabled;
    setDebugCounts((previous) => ({ ...previous, gridEnabled: runtime.grid.enabled }));
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        data-testid="dev-canvas-container"
        style={{ position: "relative", width: "100%", height: "70vh", border: "1px solid #ccc" }}
      >
        {editSession && <TextEditorOverlay session={editSession} scene={sceneRef.current} getCamera={() => cameraRef.current} />}
      </div>
      <p data-testid="dev-canvas-debug-counts">
        elements: {debugCounts.total} total / {debugCounts.visible} visible (culled:{" "}
        {debugCounts.total - debugCounts.visible}) / tool: {debugCounts.activeTool} / selected: {debugCounts.selected}
      </p>
      <button type="button" data-testid="dev-canvas-grid-toggle" onClick={toggleGrid}>
        grid: {debugCounts.gridEnabled ? "on" : "off"}
      </button>
    </div>
  );
}
