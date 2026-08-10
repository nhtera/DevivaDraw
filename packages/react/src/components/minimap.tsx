/**
 * Scene minimap (tldraw parity): a small bottom-right overview of the whole drawing with a rectangle
 * marking the current viewport. Click or drag inside it to pan the main camera there. Element bodies
 * are drawn as flat filled boxes (an overview, not a faithful re-render) onto a small canvas, redrawn
 * whenever the scene or camera changes. Auto-hidden when the scene is empty (nothing to overview).
 */
import { computeElementsBounds } from "@deviva-draw/engine";
import type { Camera } from "@deviva-draw/engine";
import { useEffect, useRef } from "react";
import { panelStyle } from "./chrome-styles";
import { useCanvasBackground, useSceneVersion } from "../runtime/use-live-version";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

const MAP_WIDTH = 180;
const MAP_HEIGHT = 130;
const MAP_PADDING = 10;

interface MinimapProps {
  runtime: DevivaRuntime;
  cameraStore: CameraStore;
  getViewportSize(): { width: number; height: number };
}

/** Fit transform mapping scene coords → minimap-canvas coords for the given scene bounds. */
function fitTransform(bounds: { x: number; y: number; width: number; height: number }) {
  const scale = Math.min((MAP_WIDTH - MAP_PADDING * 2) / Math.max(bounds.width, 1), (MAP_HEIGHT - MAP_PADDING * 2) / Math.max(bounds.height, 1));
  const offsetX = (MAP_WIDTH - bounds.width * scale) / 2 - bounds.x * scale;
  const offsetY = (MAP_HEIGHT - bounds.height * scale) / 2 - bounds.y * scale;
  return { scale, offsetX, offsetY };
}

export function Minimap(props: MinimapProps) {
  const { runtime, cameraStore, getViewportSize } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneVersion = useSceneVersion(runtime.scene);
  const canvasBackground = useCanvasBackground(runtime.scene);
  const draggingRef = useRef(false);

  const elements = runtime.scene.getElements().filter((element) => !element.isDeleted);
  const bounds = computeElementsBounds(elements);

  // Redraw whenever scene/camera/bg/size change. Camera changes come via the subscription below.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = MAP_WIDTH * dpr;
      canvas.height = MAP_HEIGHT * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
      const { scale, offsetX, offsetY } = fitTransform(bounds);

      // Element bodies as flat boxes.
      ctx.fillStyle = "rgba(127,127,127,0.55)";
      for (const element of elements) {
        ctx.fillRect(element.x * scale + offsetX, element.y * scale + offsetY, Math.max(element.width * scale, 1), Math.max(element.height * scale, 1));
      }

      // Viewport rectangle: the scene region currently visible on screen.
      const camera = cameraStore.getCamera();
      const { width: vw, height: vh } = getViewportSize();
      const viewX = -camera.scrollX;
      const viewY = -camera.scrollY;
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(viewX * scale + offsetX, viewY * scale + offsetY, (vw / camera.zoom) * scale, (vh / camera.zoom) * scale);
    };
    draw();
    return cameraStore.subscribe(draw);
  }, [bounds, elements, sceneVersion, canvasBackground, cameraStore, getViewportSize]);

  if (!bounds) return null;

  // Pan the main camera so the clicked minimap point becomes the viewport center.
  const panTo = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = fitTransform(bounds);
    const sceneX = (clientX - rect.left - offsetX) / scale;
    const sceneY = (clientY - rect.top - offsetY) / scale;
    const camera = cameraStore.getCamera();
    const { width: vw, height: vh } = getViewportSize();
    cameraStore.setCamera({ ...camera, scrollX: vw / (2 * camera.zoom) - sceneX, scrollY: vh / (2 * camera.zoom) - sceneY } as Camera);
  };

  return (
    <div
      data-testid="minimap"
      style={{ ...panelStyle, position: "absolute", bottom: 8, right: 8, width: MAP_WIDTH, height: MAP_HEIGHT, padding: 0, overflow: "hidden", zIndex: 30 }}
      onPointerDown={(event) => {
        draggingRef.current = true;
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
        panTo(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) panTo(event.clientX, event.clientY);
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
    >
      <canvas ref={canvasRef} style={{ width: MAP_WIDTH, height: MAP_HEIGHT, display: "block", cursor: "pointer" }} />
    </div>
  );
}
