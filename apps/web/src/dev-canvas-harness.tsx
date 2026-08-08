import { useEffect, useRef, useState } from "react";
import {
  CanvasStage,
  computeElementsBounds,
  createCamera,
  createDiamondElement,
  createElementTarget,
  createEllipseElement,
  createGlobalTarget,
  createRectangleElement,
  DiamondTool,
  EllipseTool,
  FreedrawTool,
  getVisibleElements,
  HistoryStack,
  LineTool,
  PanZoomTool,
  PointerEventPipeline,
  RectangleTool,
  registerCoreShortcuts,
  Scene,
  SelectionToolSkeleton,
  ShapeStyleState,
  ShortcutRegistry,
  ToolStateMachine,
} from "@deviva-draw/engine";
import type { AnyElement, Camera } from "@deviva-draw/engine";

const SEEDED_ELEMENT_COUNT = 500;
const SEED_SPREAD = 4000;
const DEBUG_POLL_MS = 250;
const SELECT_TOOL_NAME = "select";
const PAN_TOOL_NAME = "pan";
const RECTANGLE_TOOL_NAME = "rectangle";
const ELLIPSE_TOOL_NAME = "ellipse";
const DIAMOND_TOOL_NAME = "diamond";
const LINE_TOOL_NAME = "line";
const FREEDRAW_TOOL_NAME = "freedraw";

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
 * Manual test page wiring `CanvasStage` and the real input pipeline into the Vite app: the
 * selection-tool skeleton is active by default, `H` (or space/middle-mouse-drag) pans, `R`/`O`/`D`/`L`
 * switch to the rectangle/ellipse/diamond/line shape tools, `P` switches to the freehand ink tool
 * (matches Excalidraw's own pencil shortcut), wheel pans/ctrl+wheel zooms
 * (cursor-anchored), `Shift+1` zooms to fit, `Ctrl +`/`Ctrl -` step zoom — all driven by
 * `@deviva-draw/engine`'s `PointerEventPipeline`/`ToolStateMachine`, not ad-hoc DOM listeners. A
 * debug overlay reports element counts and the active tool for manual QA.
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

    // Shared "keep current style for next shape" state, and the history batch guard the shape
    // tools open on gesture start / close on commit — see `input/pointer-event-pipeline.ts`'s abort
    // path for why a tool never needs to cancel this itself.
    const styleState = new ShapeStyleState();
    const historyStack = new HistoryStack<AnyElement[]>(sceneRef.current.getElements());
    const shapeToolDeps = { scene: sceneRef.current, styleState, history: historyStack };
    const rectangleTool = new RectangleTool(shapeToolDeps);
    const ellipseTool = new EllipseTool(shapeToolDeps);
    const diamondTool = new DiamondTool(shapeToolDeps);
    // Line tool's click-proximity thresholds are screen-pixel constants converted via the live zoom.
    const lineTool = new LineTool({ ...shapeToolDeps, getZoom: () => cameraRef.current.zoom });
    const freedrawTool = new FreedrawTool(shapeToolDeps);

    const toolStateMachine = new ToolStateMachine(
      {
        [SELECT_TOOL_NAME]: selectionTool,
        [PAN_TOOL_NAME]: panZoomTool,
        [RECTANGLE_TOOL_NAME]: rectangleTool,
        [ELLIPSE_TOOL_NAME]: ellipseTool,
        [DIAMOND_TOOL_NAME]: diamondTool,
        [LINE_TOOL_NAME]: lineTool,
        [FREEDRAW_TOOL_NAME]: freedrawTool,
      },
      SELECT_TOOL_NAME,
    );

    const shortcutRegistry = new ShortcutRegistry();
    registerCoreShortcuts(shortcutRegistry);
    // Matches Excalidraw's letter conventions (muscle memory, not a trademark concern — shortcuts
    // aren't copyrightable): R/O/D/L for rectangle/ellipse("oval")/diamond/line, P for the pencil.
    shortcutRegistry.register("r", "rectangle-tool");
    shortcutRegistry.register("o", "ellipse-tool");
    shortcutRegistry.register("d", "diamond-tool");
    shortcutRegistry.register("l", "line-tool");
    shortcutRegistry.register("p", "freedraw-tool");

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
        "rectangle-tool": () => toolStateMachine.setTool(RECTANGLE_TOOL_NAME),
        "ellipse-tool": () => toolStateMachine.setTool(ELLIPSE_TOOL_NAME),
        "diamond-tool": () => toolStateMachine.setTool(DIAMOND_TOOL_NAME),
        "line-tool": () => toolStateMachine.setTool(LINE_TOOL_NAME),
        "freedraw-tool": () => toolStateMachine.setTool(FREEDRAW_TOOL_NAME),
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
