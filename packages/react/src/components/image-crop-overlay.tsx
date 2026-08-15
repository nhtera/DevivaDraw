/**
 * Image crop editor: double-clicking an (unrotated) image enters a modal crop session — the full
 * original image ghosts behind the current window, the rest of the canvas dims, and eight handles
 * (plus dragging inside the window) reshape which part stays visible. Enter/click-away commits,
 * Escape restores what the session started from. The commit follows the reference semantics: the
 * element's box *becomes* the window (the visible pixels never move on canvas) and `crop` records
 * the source-rect fractions the renderer/exporters draw from.
 *
 * The whole session is one history batch: `beginBatch` on entry, `endBatch` on commit — and Escape
 * restores the element inside the still-open batch before `cancelBatch`, so a canceled crop leaves
 * neither a change nor an undo entry. All geometry is kept in scene terms and projected per render,
 * so panning/zooming mid-crop just re-anchors the overlay instead of tearing it.
 */
import { sceneToScreen, screenToScene } from "@deviva-draw/engine";
import type { AnyElement, ImageCrop, ImageElement, Scene } from "@deviva-draw/engine";
import { useEffect, useReducer, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCameraVersion, useSceneVersion } from "../runtime/use-live-version";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

const HANDLE_SIZE = 10;
/** Smallest crop window, as a fraction of the original image on each axis. */
const MIN_CROP_FRACTION = 0.05;

interface CropSession {
  elementId: string;
  /** The full (uncropped) image's display box in scene units — constant for the session. */
  original: { x: number; y: number; width: number; height: number };
  /** The element exactly as the session found it, for Escape. */
  entry: { x: number; y: number; width: number; height: number; crop: ImageCrop | null };
}

function fullBoxOf(element: ImageElement): CropSession["original"] {
  const crop = element.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = element.width / crop.width;
  const height = element.height / crop.height;
  return { x: element.x - crop.x * width, y: element.y - crop.y * height, width, height };
}

export function ImageCropOverlay(props: { runtime: DevivaRuntime; cameraStore: CameraStore }) {
  const { runtime, cameraStore } = props;
  const [session, setSession] = useState<CropSession | null>(null);
  useSceneVersion(runtime.scene);
  useCameraVersion(cameraStore);
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const dragRef = useRef<{ handle: string; startClient: { x: number; y: number }; startWindow: { x: number; y: number; width: number; height: number } } | null>(null);

  useEffect(() => {
    const onEnter = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail.id;
      const element = runtime.scene.getElement(id);
      if (!element || element.type !== "image" || element.isDeleted) return;
      runtime.history.beginBatch();
      setSession({
        elementId: id,
        original: fullBoxOf(element),
        entry: { x: element.x, y: element.y, width: element.width, height: element.height, crop: element.crop ?? null },
      });
    };
    window.addEventListener("deviva:image-crop", onEnter);
    return () => window.removeEventListener("deviva:image-crop", onEnter);
  }, [runtime]);

  useEffect(() => {
    if (!session) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter") return;
      event.stopPropagation();
      if (event.key === "Escape") {
        // `crop` is an image-only field: typed through the distributive `Partial<AnyElement>` (see `edit-actions.ts`'s same note).
        const restore: Partial<AnyElement> = { x: session.entry.x, y: session.entry.y, width: session.entry.width, height: session.entry.height, crop: session.entry.crop };
        runtime.scene.updateElement(session.elementId, restore);
        runtime.history.cancelBatch();
      } else {
        runtime.history.endBatch(runtime.scene.getElements());
      }
      setSession(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [session, runtime]);

  if (!session) return null;
  const element = runtime.scene.getElement(session.elementId);
  if (!element || element.type !== "image" || element.isDeleted) return null;

  const camera = cameraStore.getCamera();
  const originalTopLeft = sceneToScreen({ x: session.original.x, y: session.original.y }, camera);
  const originalBox = { x: originalTopLeft.x, y: originalTopLeft.y, width: session.original.width * camera.zoom, height: session.original.height * camera.zoom };
  const windowTopLeft = sceneToScreen({ x: element.x, y: element.y }, camera);
  const windowBox = { x: windowTopLeft.x, y: windowTopLeft.y, width: element.width * camera.zoom, height: element.height * camera.zoom };
  const file = runtime.scene.getFile(element.fileId);

  const commit = () => {
    runtime.history.endBatch(runtime.scene.getElements());
    setSession(null);
  };

  /** Applies a new screen-space window: the element box becomes the window; `crop` follows from where it sits inside the original. */
  const applyWindow = (next: { x: number; y: number; width: number; height: number }) => {
    const topLeft = screenToScene({ x: next.x, y: next.y }, camera);
    const sceneWindow = { x: topLeft.x, y: topLeft.y, width: next.width / camera.zoom, height: next.height / camera.zoom };
    const crop: ImageCrop = {
      x: (sceneWindow.x - session.original.x) / session.original.width,
      y: (sceneWindow.y - session.original.y) / session.original.height,
      width: sceneWindow.width / session.original.width,
      height: sceneWindow.height / session.original.height,
    };
    const changes: Partial<AnyElement> = { x: sceneWindow.x, y: sceneWindow.y, width: sceneWindow.width, height: sceneWindow.height, crop };
    runtime.scene.updateElement(session.elementId, changes);
    bump();
  };

  const startDrag = (handle: string) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Synthetic/untrusted pointers have no active id to capture — the root's move/up handlers still track the drag.
    }
    dragRef.current = { handle, startClient: { x: event.clientX, y: event.clientY }, startWindow: { ...windowBox } };
  };
  const onDragMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startClient.x;
    const dy = event.clientY - drag.startClient.y;
    const start = drag.startWindow;
    const minW = session.original.width * camera.zoom * MIN_CROP_FRACTION;
    const minH = session.original.height * camera.zoom * MIN_CROP_FRACTION;
    let { x, y, width, height } = start;
    if (drag.handle === "move") {
      x = Math.min(Math.max(start.x + dx, originalBox.x), originalBox.x + originalBox.width - width);
      y = Math.min(Math.max(start.y + dy, originalBox.y), originalBox.y + originalBox.height - height);
    } else {
      if (drag.handle.includes("w")) {
        const right = start.x + start.width;
        x = Math.min(Math.max(start.x + dx, originalBox.x), right - minW);
        width = right - x;
      }
      if (drag.handle.includes("e")) width = Math.min(Math.max(start.width + dx, minW), originalBox.x + originalBox.width - start.x);
      if (drag.handle.includes("n")) {
        const bottom = start.y + start.height;
        y = Math.min(Math.max(start.y + dy, originalBox.y), bottom - minH);
        height = bottom - y;
      }
      if (drag.handle.includes("s")) height = Math.min(Math.max(start.height + dy, minH), originalBox.y + originalBox.height - start.y);
    }
    applyWindow({ x, y, width, height });
  };
  const endDrag = () => (dragRef.current = null);

  const handles: Array<{ id: string; left: number; top: number; cursor: string }> = [
    { id: "nw", left: windowBox.x, top: windowBox.y, cursor: "nwse-resize" },
    { id: "n", left: windowBox.x + windowBox.width / 2, top: windowBox.y, cursor: "ns-resize" },
    { id: "ne", left: windowBox.x + windowBox.width, top: windowBox.y, cursor: "nesw-resize" },
    { id: "e", left: windowBox.x + windowBox.width, top: windowBox.y + windowBox.height / 2, cursor: "ew-resize" },
    { id: "se", left: windowBox.x + windowBox.width, top: windowBox.y + windowBox.height, cursor: "nwse-resize" },
    { id: "s", left: windowBox.x + windowBox.width / 2, top: windowBox.y + windowBox.height, cursor: "ns-resize" },
    { id: "sw", left: windowBox.x, top: windowBox.y + windowBox.height, cursor: "nesw-resize" },
    { id: "w", left: windowBox.x, top: windowBox.y + windowBox.height / 2, cursor: "ew-resize" },
  ];

  return (
    <div data-testid="image-crop-overlay" style={{ position: "absolute", inset: 0, zIndex: 40 }} onPointerDown={commit} onPointerMove={onDragMove} onPointerUp={endDrag}>
      {/* Ghost of the full original image behind the live (already-cropped) canvas pixels. */}
      {file && <img src={file.dataURL} alt="" draggable={false} style={{ position: "absolute", left: originalBox.x, top: originalBox.y, width: originalBox.width, height: originalBox.height, opacity: 0.35, pointerEvents: "none" }} />}
      {/* Window frame; dragging inside pans the crop window across the original. */}
      <div
        data-testid="image-crop-window"
        onPointerDown={startDrag("move")}
        style={{ position: "absolute", left: windowBox.x, top: windowBox.y, width: windowBox.width, height: windowBox.height, border: "2px solid var(--dd-accent)", boxShadow: "0 0 0 100000px rgba(0,0,0,0.35)", cursor: "move", boxSizing: "border-box" }}
      />
      {handles.map((handle) => (
        <div
          key={handle.id}
          data-testid={`image-crop-handle-${handle.id}`}
          onPointerDown={startDrag(handle.id)}
          style={{
            position: "absolute",
            left: handle.left - HANDLE_SIZE / 2,
            top: handle.top - HANDLE_SIZE / 2,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            background: "var(--dd-chrome-background-elevated)",
            border: "2px solid var(--dd-accent)",
            borderRadius: 3,
            cursor: handle.cursor,
            boxSizing: "border-box",
          }}
        />
      ))}
    </div>
  );
}

/** Narrow re-export so `deviva-draw-shell.tsx` can gate rendering without importing Scene internals. */
export function isCroppableImage(scene: Scene, id: string): boolean {
  const element = scene.getElement(id);
  return Boolean(element && element.type === "image" && !element.isDeleted && element.angle === 0);
}
