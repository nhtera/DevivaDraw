import { useEffect, useRef, useState } from "react";
import {
  CanvasStage,
  computeElementsBounds,
  createCamera,
  createElementTarget,
  createGenericElement,
  createGlobalTarget,
  getVisibleElements,
  HistoryStack,
  PanZoomTool,
  PointerEventPipeline,
  registerCoreShortcuts,
  Scene,
  SelectionToolSkeleton,
  ShortcutRegistry,
  ToolStateMachine,
} from "@deviva-draw/engine";
import type { AnyElement, Camera } from "@deviva-draw/engine";

const SEEDED_ELEMENT_COUNT = 500;
const SEED_SPREAD = 4000;
const DEBUG_POLL_MS = 250;
const SELECT_TOOL_NAME = "select";
const PAN_TOOL_NAME = "pan";

/** Scatters `SEEDED_ELEMENT_COUNT` fake generic elements across a large scene area for pan/zoom/culling testing. */
function seedScene(scene: Scene): void {
  for (let i = 0; i < SEEDED_ELEMENT_COUNT; i += 1) {
    scene.addElement(
      createGenericElement({
        x: Math.random() * SEED_SPREAD - SEED_SPREAD / 2,
        y: Math.random() * SEED_SPREAD - SEED_SPREAD / 2,
        width: 20 + Math.random() * 60,
        height: 20 + Math.random() * 60,
        strokeColor: `hsl(${Math.floor(Math.random() * 360)}, 70%, 45%)`,
      }),
    );
  }
}

/**
 * Manual test page wiring `CanvasStage` and the real input pipeline into the Vite app: the
 * selection-tool skeleton is active by default, `H` (or space/middle-mouse-drag) pans, wheel
 * pans/ctrl+wheel zooms (cursor-anchored), `Shift+1` zooms to fit, `Ctrl +`/`Ctrl -` step zoom — all
 * driven by `@deviva-draw/engine`'s `PointerEventPipeline`/`ToolStateMachine`, not ad-hoc DOM
 * listeners. A debug overlay reports element counts and the active tool for manual QA.
 */
export function DevCanvasHarness() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene>(new Scene());
  const cameraRef = useRef<Camera>(createCamera());
  const [debugCounts, setDebugCounts] = useState({ total: 0, visible: 0, activeTool: SELECT_TOOL_NAME });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (sceneRef.current.getElements().length === 0) seedScene(sceneRef.current);

    const stage = new CanvasStage();
    stage.mount(container);
    const unsubscribe = sceneRef.current.subscribe(() => stage.staticLayer.invalidate());

    let frameHandle = requestAnimationFrame(function renderFrame() {
      stage.staticLayer.render(sceneRef.current, cameraRef.current);
      stage.interactiveLayer.render({}, cameraRef.current);
      frameHandle = requestAnimationFrame(renderFrame);
    });

    const panZoomTool = new PanZoomTool({
      getCamera: () => cameraRef.current,
      setCamera: (camera) => {
        cameraRef.current = camera;
      },
      getViewportSize: () => ({ width: container.clientWidth, height: container.clientHeight }),
      getSceneBounds: () => computeElementsBounds(sceneRef.current.elementsUnsorted()),
    });
    const selectionTool = new SelectionToolSkeleton();
    const toolStateMachine = new ToolStateMachine(
      { [SELECT_TOOL_NAME]: selectionTool, [PAN_TOOL_NAME]: panZoomTool },
      SELECT_TOOL_NAME,
    );

    const shortcutRegistry = new ShortcutRegistry();
    registerCoreShortcuts(shortcutRegistry);

    // Proves the abort-path -> `HistoryStack.cancelBatch()` guard wires up cleanly; no concrete
    // tool in this phase opens a batch yet (that starts with the first Scene-mutating tool).
    const historyStack = new HistoryStack<AnyElement[]>(sceneRef.current.getElements());

    const pipeline = new PointerEventPipeline({
      element: createElementTarget(container),
      globalTarget: createGlobalTarget(window),
      toolStateMachine,
      panZoomTool,
      shortcutRegistry,
      getCamera: () => cameraRef.current,
      historyStack,
      actionHandlers: {
        "select-tool": () => toolStateMachine.setTool(SELECT_TOOL_NAME),
        "pan-tool": () => toolStateMachine.setTool(PAN_TOOL_NAME),
        "zoom-in": () => panZoomTool.zoomStep(1),
        "zoom-out": () => panZoomTool.zoomStep(-1),
        "zoom-to-fit": () => panZoomTool.zoomToFit(),
      },
    });
    pipeline.attach();

    const debugInterval = window.setInterval(() => {
      const viewportSize = { width: container.clientWidth, height: container.clientHeight };
      setDebugCounts({
        total: sceneRef.current.getElements().length,
        visible: getVisibleElements(sceneRef.current, cameraRef.current, viewportSize).length,
        activeTool: toolStateMachine.getActiveToolName(),
      });
    }, DEBUG_POLL_MS);

    return () => {
      cancelAnimationFrame(frameHandle);
      window.clearInterval(debugInterval);
      unsubscribe();
      pipeline.detach();
      stage.unmount();
    };
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        data-testid="dev-canvas-container"
        style={{ position: "relative", width: "100%", height: "70vh", border: "1px solid #ccc" }}
      />
      <p data-testid="dev-canvas-debug-counts">
        elements: {debugCounts.total} total / {debugCounts.visible} visible (culled:{" "}
        {debugCounts.total - debugCounts.visible}) / tool: {debugCounts.activeTool}
      </p>
    </div>
  );
}
