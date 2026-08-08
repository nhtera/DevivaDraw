/**
 * Converts local pointermove/pointerleave events on `containerRef` into scene-coordinate cursor
 * broadcasts for collaborators — mirrors `@deviva-draw/engine`'s `PointerEventPipeline.toScenePoint`
 * exactly (`clientX`/`clientY` minus the container's bounding rect, then `screenToScene`) so a remote
 * peer's cursor lands in the same place a local click would. A separate listener pair, not folded into
 * the pointer pipeline itself: this is presence bookkeeping, not a tool gesture, so it must keep firing
 * regardless of which tool is active or whether a gesture is in progress.
 */
import { useEffect } from "react";
import type { RefObject } from "react";
import { screenToScene } from "@deviva-draw/engine";
import type { Camera } from "@deviva-draw/engine";

export interface UseCollabCursorTrackingOptions {
  containerRef: RefObject<HTMLElement | null>;
  getCamera(): Camera;
  onCursorMove(point: { x: number; y: number } | null): void;
  /** Only attach listeners (and broadcast) while a session is actually connected — collaboration is opt-in, so an idle/disconnected session must never pay for pointer tracking. */
  active: boolean;
}

export function useCollabCursorTracking(options: UseCollabCursorTrackingOptions): void {
  const { containerRef, getCamera, onCursorMove, active } = options;

  useEffect(() => {
    if (!active) return;
    const element = containerRef.current;
    if (!element) return;

    const handleMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const point = screenToScene({ x: event.clientX - rect.left, y: event.clientY - rect.top }, getCamera());
      onCursorMove(point);
    };
    const handleLeave = () => onCursorMove(null);

    element.addEventListener("pointermove", handleMove);
    element.addEventListener("pointerleave", handleLeave);
    return () => {
      element.removeEventListener("pointermove", handleMove);
      element.removeEventListener("pointerleave", handleLeave);
      onCursorMove(null);
    };
  }, [containerRef, getCamera, onCursorMove, active]);
}
