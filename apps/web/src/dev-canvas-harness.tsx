import { useEffect, useRef, useState } from "react";
import {
  CanvasStage,
  Scene,
  clampZoom,
  createCamera,
  createGenericElement,
  getVisibleElements,
  screenToScene,
} from "@deviva-draw/engine";
import type { Camera } from "@deviva-draw/engine";

const SEEDED_ELEMENT_COUNT = 500;
const SEED_SPREAD = 4000;
const ZOOM_STEP = 1.1;
const DEBUG_POLL_MS = 250;

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
 * Temporary manual test page wiring `CanvasStage` into the Vite app: mouse-wheel zoom (anchored
 * at the cursor), drag-to-pan, and a debug overlay counting total vs. culled-in elements — proves
 * pan/zoom/culling work end to end before the real tool/input pipeline exists. Deleted or
 * replaced once that pointer/tool pipeline lands.
 */
export function DevCanvasHarness() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene>(new Scene());
  const cameraRef = useRef<Camera>(createCamera());
  const [debugCounts, setDebugCounts] = useState({ total: 0, visible: 0 });

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

    let panPointerId: number | null = null;
    let lastClientX = 0;
    let lastClientY = 0;

    const onPointerDown = (event: PointerEvent) => {
      panPointerId = event.pointerId;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      container.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (panPointerId !== event.pointerId) return;
      const camera = cameraRef.current;
      const dx = (event.clientX - lastClientX) / camera.zoom;
      const dy = (event.clientY - lastClientY) / camera.zoom;
      cameraRef.current = { ...camera, scrollX: camera.scrollX + dx, scrollY: camera.scrollY + dy };
      lastClientX = event.clientX;
      lastClientY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (panPointerId === event.pointerId) panPointerId = null;
    };
    // Zoom anchored at the cursor: keeps the scene point under the pointer fixed on screen by
    // re-solving scrollX/scrollY after applying the new zoom, rather than zooming around the origin.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const camera = cameraRef.current;
      const rect = container.getBoundingClientRect();
      const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const sceneUnderCursor = screenToScene(screenPoint, camera);
      const zoom = clampZoom(camera.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
      const sceneUnderCursorAtNewZoom = screenToScene(screenPoint, { ...camera, zoom });
      cameraRef.current = {
        zoom,
        scrollX: camera.scrollX + (sceneUnderCursorAtNewZoom.x - sceneUnderCursor.x),
        scrollY: camera.scrollY + (sceneUnderCursorAtNewZoom.y - sceneUnderCursor.y),
      };
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    const debugInterval = window.setInterval(() => {
      const viewportSize = { width: container.clientWidth, height: container.clientHeight };
      setDebugCounts({
        total: sceneRef.current.getElements().length,
        visible: getVisibleElements(sceneRef.current, cameraRef.current, viewportSize).length,
      });
    }, DEBUG_POLL_MS);

    return () => {
      cancelAnimationFrame(frameHandle);
      window.clearInterval(debugInterval);
      unsubscribe();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("wheel", onWheel);
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
        {debugCounts.total - debugCounts.visible})
      </p>
    </div>
  );
}
