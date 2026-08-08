/**
 * Wires both ways a context menu opens: desktop right-click (native `contextmenu`, default-prevented
 * so the browser's own menu never shows) and mobile long-press (`mobile/touch-gesture-adapter.ts`'s
 * `onLongPress`, which also drives the pinch-zoom/two-finger-pan gesture recognition on the
 * same adapter instance — one attachment covers both mobile milestones (b) and (c)).
 */
import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { TouchGestureAdapter } from "../components/mobile/touch-gesture-adapter";
import type { CameraStore } from "./camera-store";

export interface ContextMenuPoint {
  x: number;
  y: number;
}

export function useContextMenuTriggers(containerRef: RefObject<HTMLDivElement | null>, cameraStore: CameraStore | null): {
  point: ContextMenuPoint | null;
  close(): void;
} {
  const [point, setPoint] = useState<ContextMenuPoint | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cameraStore) return;

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      setPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    container.addEventListener("contextmenu", handleContextMenu);

    const touchAdapter = new TouchGestureAdapter({
      element: container,
      getCamera: cameraStore.getCamera,
      setCamera: cameraStore.setCamera,
      onLongPress: (screenPoint) => setPoint(screenPoint),
    });
    touchAdapter.attach();

    return () => {
      container.removeEventListener("contextmenu", handleContextMenu);
      touchAdapter.detach();
    };
  }, [containerRef, cameraStore]);

  return { point, close: () => setPoint(null) };
}
