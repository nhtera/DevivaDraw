/**
 * Scene minimap (tldraw parity): a small bottom-right overview of the whole drawing with a rectangle
 * marking the current viewport. Click or drag inside it to pan the main camera there. Element bodies
 * are drawn as flat filled boxes (an overview, not a faithful re-render) onto a small canvas, redrawn
 * whenever the scene or camera changes. Auto-hidden when the scene is empty (nothing to overview).
 *
 * Boxes carry each element's *own* color (theme-adapted through the same
 * `theme/canvas-color-inversion.ts` the canvas renders with, so the overview matches what's on screen in
 * either theme). A uniform grey would collapse a busy scene into one indistinguishable slab, which
 * defeats the only thing a minimap is for: recognising *where* in your drawing you are.
 */
import { computeElementsBounds } from "@deviva-draw/engine";
import type { AnyElement, Camera } from "@deviva-draw/engine";
import { useEffect, useMemo, useRef } from "react";
import { panelStyle } from "./chrome-styles";
import { adaptBackgroundColorForTheme, adaptStrokeColorForTheme } from "../theme/canvas-color-inversion";
import { useCanvasBackground, useSceneVersion } from "../runtime/use-live-version";
import { useStableCallback } from "../runtime/use-stable-ref";
import type { ThemeMode } from "../theme/theme-tokens";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

const MAP_WIDTH = 180;
const MAP_HEIGHT = 130;
const MAP_PADDING = 10;
/** Gap between the minimap and the viewport edges. */
const MAP_INSET = 8;
/**
 * Custom property the minimap publishes on the app root while mounted, holding the vertical space it
 * occupies in the bottom-right corner. The top-right properties panel subtracts it from its own height
 * cap so the two never overlap — see `properties-panel.tsx`. Published from here (rather than hard-coded
 * there) so the minimap's dimensions stay owned by this file.
 */
const RESERVED_SPACE_PROPERTY = "--dd-minimap-reserved";

interface MinimapProps {
  runtime: DevivaRuntime;
  cameraStore: CameraStore;
  getViewportSize(): { width: number; height: number };
}

/** Alpha applied to an element's own color in the overview — enough to read the shape, soft enough that overlaps stay legible. */
const BOX_ALPHA = 0.75;
/** Alpha for an unfilled (transparent-background) element, painted from its stroke color so outlines still register. */
const OUTLINE_ONLY_ALPHA = 0.4;

/**
 * The color an element contributes to the overview: its fill when it has one, otherwise a fainter wash
 * of its stroke — so a transparent-background rectangle still shows up instead of vanishing.
 */
function overviewColor(element: AnyElement, mode: ThemeMode): { color: string; alpha: number } {
  const background = adaptBackgroundColorForTheme(element.backgroundColor, mode);
  if (background && background !== "transparent") return { color: background, alpha: BOX_ALPHA };
  return { color: adaptStrokeColorForTheme(element.strokeColor, mode), alpha: OUTLINE_ONLY_ALPHA };
}

/** Fit transform mapping scene coords → minimap-canvas coords for the given scene bounds. */
function fitTransform(bounds: { x: number; y: number; width: number; height: number }) {
  const scale = Math.min((MAP_WIDTH - MAP_PADDING * 2) / Math.max(bounds.width, 1), (MAP_HEIGHT - MAP_PADDING * 2) / Math.max(bounds.height, 1));
  const offsetX = (MAP_WIDTH - bounds.width * scale) / 2 - bounds.x * scale;
  const offsetY = (MAP_HEIGHT - bounds.height * scale) / 2 - bounds.y * scale;
  return { scale, offsetX, offsetY };
}

export function Minimap(props: MinimapProps) {
  const { runtime, cameraStore } = props;
  // The shell passes a fresh arrow function every render; without stabilising it the draw effect below
  // would tear down and re-subscribe to the camera store on every render of the whole shell.
  const getViewportSize = useStableCallback(props.getViewportSize);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneVersion = useSceneVersion(runtime.scene);
  const canvasBackground = useCanvasBackground(runtime.scene);
  const themeMode = runtime.theme.mode;
  const draggingRef = useRef(false);

  // Memoized on the scene version: both of these are fresh arrays/objects on every render, and they are
  // `useEffect` dependencies below — without this the draw effect tears down and re-subscribes to the
  // camera store on every single React render of this component, not just when the scene actually changed.
  // `sceneVersion` is the dependency that matters: `runtime.scene` is a stable instance mutated in
  // place, so its identity never changes and only the version counter signals new contents.
  const { elements, bounds } = useMemo(() => {
    const live = runtime.scene.getElements().filter((element) => !element.isDeleted);
    return { elements: live, bounds: computeElementsBounds(live) };
  }, [runtime.scene, sceneVersion]);
  const isVisible = bounds !== null;

  // Publish/retract the bottom-right space this map occupies, so the properties panel can cap its own
  // height against it. Keyed on `isVisible` because the map auto-hides on an empty scene, and the panel
  // must reclaim the space the moment it does.
  useEffect(() => {
    const root = canvasRef.current?.closest<HTMLElement>('[data-testid="deviva-draw-root"]');
    if (!root) return;
    root.style.setProperty(RESERVED_SPACE_PROPERTY, `${MAP_HEIGHT + MAP_INSET * 2}px`);
    return () => {
      root.style.removeProperty(RESERVED_SPACE_PROPERTY);
    };
  }, [isVisible]);

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

      // Element bodies as flat boxes, each in its own theme-adapted color.
      for (const element of elements) {
        const { color, alpha } = overviewColor(element, themeMode);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillRect(element.x * scale + offsetX, element.y * scale + offsetY, Math.max(element.width * scale, 1), Math.max(element.height * scale, 1));
      }
      ctx.globalAlpha = 1;

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
  }, [bounds, elements, canvasBackground, themeMode, cameraStore, getViewportSize]);

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
      style={{
        ...panelStyle,
        position: "absolute",
        bottom: MAP_INSET,
        // Shifts left by the library sidebar's width while that panel is open — it is a full-height
        // right-edge panel and would otherwise cover this one. Absent ⇒ 0px.
        right: `calc(${MAP_INSET}px + var(--dd-library-sidebar-width, 0px))`,
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        padding: 0,
        overflow: "hidden",
        zIndex: 30,
      }}
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
