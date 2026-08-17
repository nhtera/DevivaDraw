/**
 * Wires both ways a context menu opens: desktop right-click (native `contextmenu`, default-prevented
 * so the browser's own menu never shows) and mobile long-press (`mobile/touch-gesture-adapter.ts`'s
 * `onLongPress`, which also drives the pinch-zoom/two-finger-pan gesture recognition on the
 * same adapter instance — one attachment covers both mobile milestones (b) and (c)).
 *
 * Also decides *which* menu the click deserves: a right-click that lands on an
 * element — or inside the current selection's bounds — opens the element menu, selecting the hit
 * element (with its whole group) first when it wasn't already selected, exactly like a left-click
 * would. A right-click on empty canvas opens the canvas menu (paste/select-all/view toggles)
 * instead, leaving any existing selection alone.
 */
import { expandToGroupMembers, screenToScene, selectionBoundsOf, topmostElementAt } from "@deviva-draw/engine";
import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { TouchGestureAdapter } from "../components/mobile/touch-gesture-adapter";
import type { CameraStore } from "./camera-store";
import type { DevivaRuntime } from "./runtime-types";

export interface ContextMenuPoint {
  x: number;
  y: number;
}

export type ContextMenuVariant = "element" | "canvas";

/** Same on-screen click slop the select tool itself uses (`CLICK_HIT_PX`), so a right-click selects exactly what a left-click at the same spot would. */
const CLICK_HIT_PX = 5;

export function useContextMenuTriggers(
  containerRef: RefObject<HTMLDivElement | null>,
  cameraStore: CameraStore | null,
  // A ref, not the runtime itself: this hook must be callable before `useDevivaRuntime` has run (the
  // shell's `isChromeOverlayOpen` reads the open state it returns), so the runtime is read lazily at
  // event time instead of captured at attach time.
  runtimeRef: RefObject<DevivaRuntime | null>,
): {
  point: ContextMenuPoint | null;
  variant: ContextMenuVariant;
  close(): void;
} {
  const [target, setTarget] = useState<{ point: ContextMenuPoint; variant: ContextMenuVariant } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cameraStore) return;

    const openAt = (screenPoint: ContextMenuPoint) => {
      setTarget({ point: screenPoint, variant: resolveVariant(runtimeRef.current, cameraStore, screenPoint) });
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      openAt({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    container.addEventListener("contextmenu", handleContextMenu);

    const touchAdapter = new TouchGestureAdapter({
      element: container,
      getCamera: cameraStore.getCamera,
      setCamera: cameraStore.setCamera,
      onLongPress: openAt,
      // Read lazily off the runtime ref (same reason the ref exists — this hook attaches before the
      // runtime is built): the pipeline knows which touches are a resting palm around a pen stroke
      // or a finger mid-camera-pan, neither of which may pop the context menu.
      shouldSuppressLongPress: (pointerId) => runtimeRef.current?.pipeline?.shouldSuppressTouchLongPress(pointerId) ?? false,
      // Touch double-tap routes into the same double-click-to-edit dispatch the desktop dblclick
      // uses (table cells, labels, standalone text) — iOS never synthesizes dblclick from taps.
      onDoubleTap: (clientPoint) => runtimeRef.current?.openDoubleClickEdit(clientPoint.x, clientPoint.y) ?? false,
    });
    touchAdapter.attach();

    return () => {
      container.removeEventListener("contextmenu", handleContextMenu);
      touchAdapter.detach();
    };
  }, [containerRef, cameraStore, runtimeRef]);

  return { point: target?.point ?? null, variant: target?.variant ?? "element", close: () => setTarget(null) };
}

/**
 * Element menu when the click hits an element (selecting it — and its group — first if needed) or
 * lands inside the selection's rotation-aware bounds; canvas menu otherwise. The bounds test is what
 * keeps a multi-element selection right-clickable in the empty space *between* its members.
 */
function resolveVariant(runtime: DevivaRuntime | null, cameraStore: CameraStore, screenPoint: ContextMenuPoint): ContextMenuVariant {
  if (!runtime) return "canvas";
  const camera = cameraStore.getCamera();
  const scenePoint = screenToScene(screenPoint, camera);
  const hit = topmostElementAt(runtime.scene, scenePoint, CLICK_HIT_PX / camera.zoom);
  if (hit) {
    if (!runtime.selection.isSelected(hit.id)) {
      runtime.selection.selectOnly(expandToGroupMembers(runtime.scene, [hit.id]));
    }
    return "element";
  }
  const ids = runtime.selection.getSelectedIds();
  if (ids.size > 0) {
    const selected = runtime.scene.getElements().filter((element) => !element.isDeleted && ids.has(element.id));
    const bounds = selectionBoundsOf(selected);
    if (
      bounds &&
      scenePoint.x >= bounds.x &&
      scenePoint.x <= bounds.x + bounds.width &&
      scenePoint.y >= bounds.y &&
      scenePoint.y <= bounds.y + bounds.height
    ) {
      return "element";
    }
  }
  return "canvas";
}
