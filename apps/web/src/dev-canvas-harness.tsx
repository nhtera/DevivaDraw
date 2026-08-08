import { useEffect, useRef, useState } from "react";
import {
  CanvasStage,
  createCamera,
  createDiamondElement,
  createEllipseElement,
  createRectangleElement,
  getVisibleElements,
  Scene,
} from "@deviva-draw/engine";
import type { Camera, TextEditSession } from "@deviva-draw/engine";
import { TextEditorOverlay } from "@deviva-draw/react";
import { createDevCanvasHarnessRuntime, SELECT_TOOL_NAME } from "./dev-canvas-harness-runtime";

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
 * Manual test page wiring `CanvasStage` and the real input pipeline into the Vite app: the
 * selection-tool skeleton is active by default, `H` (or space/middle-mouse-drag) pans, `R`/`O`/`D`/`L`
 * switch to the rectangle/ellipse/diamond/line shape tools, `P` switches to the freehand ink tool
 * (matches Excalidraw's own pencil shortcut), `T` switches to the text tool (click to place, type,
 * click away/Escape to commit), double-click inside a rect/ellipse/diamond edits its bound label,
 * wheel pans/ctrl+wheel zooms (cursor-anchored), `Shift+1` zooms to fit, `Ctrl +`/`Ctrl -` step zoom
 * — all driven by `@deviva-draw/engine`'s `PointerEventPipeline`/`ToolStateMachine` (tool/pipeline
 * construction lives in `dev-canvas-harness-runtime.ts`, split out to keep this component small). A
 * debug overlay reports element counts and the active tool for manual QA.
 */
export function DevCanvasHarness() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene>(new Scene());
  const cameraRef = useRef<Camera>(createCamera());
  const [debugCounts, setDebugCounts] = useState({ total: 0, visible: 0, activeTool: SELECT_TOOL_NAME });
  // Set once the effect below constructs the runtime — the overlay only renders once this exists;
  // a ref alone wouldn't trigger the re-render needed to mount it.
  const [editSession, setEditSession] = useState<TextEditSession | null>(null);

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

    const runtime = createDevCanvasHarnessRuntime(
      container,
      sceneRef.current,
      () => cameraRef.current,
      (camera) => {
        cameraRef.current = camera;
      },
    );
    setEditSession(runtime.editSession);

    const debugInterval = window.setInterval(() => {
      const viewportSize = { width: container.clientWidth, height: container.clientHeight };
      setDebugCounts({
        total: sceneRef.current.getElements().length,
        visible: getVisibleElements(sceneRef.current, cameraRef.current, viewportSize).length,
        activeTool: runtime.toolStateMachine.getActiveToolName(),
      });
    }, DEBUG_POLL_MS);

    return () => {
      cancelAnimationFrame(frameHandle);
      window.clearInterval(debugInterval);
      unsubscribe();
      runtime.dispose();
      stage.unmount();
      setEditSession(null);
    };
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
        {debugCounts.total - debugCounts.visible}) / tool: {debugCounts.activeTool}
      </p>
    </div>
  );
}
