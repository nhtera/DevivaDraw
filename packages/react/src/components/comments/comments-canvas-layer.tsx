/**
 * Everything comments draw over the canvas: the pins, and the open thread's popover beside its pin.
 * Positioned in scene coordinates and re-projected on every scene/camera change — the same
 * camera-transform + subscription approach `link-badges-overlay.tsx` uses, and a SIBLING of the
 * canvas host for the same reason: the engine's pointer pipeline listens on the host, so clicking a
 * pin here can never also start a marquee or change the selection beneath.
 *
 * The popover lives here rather than in the shell precisely BECAUSE of that camera subscription: the
 * shell must not re-render on every pan, so a component that already tracks the camera is the only
 * place a canvas-anchored popover can follow its pin without costing a full-shell render per frame.
 * A thread with no pin at all (resolved, or `page`-anchored — both reachable only from the panel)
 * falls back to a fixed screen position, so opening one from the panel always shows something.
 *
 * What is deliberately NOT drawn:
 * - resolved threads (the conversation is finished; the panel still lists it),
 * - threads anchored to a hidden layer's shape (a pin must not advertise content the layer hides),
 * - `page`-anchored threads, which have no canvas position by definition,
 * - anything at all while presenting — an audience is not looking at review notes.
 *
 * Pins are chrome, never document content: nothing here reaches any export path, because exports
 * serialize the scene's elements and a comment is not an element.
 */
import { resolveCommentAnchor, sceneToScreen } from "@deviva-draw/engine";
import type { CommentThread, Scene } from "@deviva-draw/engine";
import { useEffect, useReducer } from "react";
import { Icon } from "../icon";
import { CommentThreadPopover } from "./comment-thread-popover";
import { useSceneVersion } from "../../runtime/use-live-version";
import type { CameraStore } from "../../runtime/camera-store";

const PIN_SIZE = 24;

/** Where a pinless thread's popover sits — top-left of the canvas area, clear of the top bar. */
const PINLESS_POPOVER_POSITION = { x: 16, y: 76 };
/** Screen-space gap between a pin and its popover. */
const POPOVER_GAP_PX = 8;

export interface CommentsCanvasLayerProps {
  scene: Scene;
  cameraStore: CameraStore;
  /** The thread whose popover is open, highlighted so the pin and the popover read as one object. */
  openThreadId: string | null;
  onOpenThread(threadId: string | null): void;
  /** A read-only surface shows the conversation but cannot add to it. */
  readOnly?: boolean;
}

/** The threads that belong on the canvas right now, with their current screen position. Exported for the panel's "does this thread have a pin?" check and for unit testing the gating rules without a DOM. */
export function visibleCanvasThreads(scene: Scene): { thread: CommentThread; point: { x: number; y: number } }[] {
  const visible: { thread: CommentThread; point: { x: number; y: number } }[] = [];
  for (const thread of scene.getCommentThreads()) {
    if (thread.resolved) continue;
    const point = resolveCommentAnchor(thread.anchor, scene);
    if (!point) continue; // a page-anchored thread lives in the panel only
    if (thread.anchor.kind === "element") {
      const element = scene.getElement(thread.anchor.elementId);
      // A live anchor element on a hidden layer hides its pin too; an ABSENT one does not — that
      // thread has already degraded to a point pin and must stay reachable.
      if (element && scene.isElementHidden(element)) continue;
    }
    visible.push({ thread, point });
  }
  return visible;
}

export function CommentsCanvasLayer(props: CommentsCanvasLayerProps) {
  const { scene, cameraStore, openThreadId, onOpenThread, readOnly = false } = props;
  useSceneVersion(scene); // reposition pins as their anchor shapes move, and add/remove on comment changes
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => cameraStore.subscribe(() => bump()), [cameraStore]);

  const camera = cameraStore.getCamera();
  const threads = visibleCanvasThreads(scene);
  // The open thread may have no pin (resolved, page-anchored, or opened from the panel just as the
  // last peer resolved it) — it still gets a popover, at the fallback position.
  const openThread = openThreadId === null ? undefined : scene.getCommentThread(openThreadId);
  const openPin = threads.find((entry) => entry.thread.id === openThreadId);
  const popoverPosition = openPin ? offsetFromPin(sceneToScreen(openPin.point, camera)) : PINLESS_POPOVER_POSITION;
  if (threads.length === 0 && !openThread) return null;

  return (
    <>
      {threads.map(({ thread, point }) => {
        const screen = sceneToScreen(point, camera);
        const open = thread.id === openThreadId;
        const replies = scene.getCommentMessages(thread.id).length;
        return (
          <button
            key={thread.id}
            type="button"
            data-testid={`comment-pin-${thread.id}`}
            title={thread.authorName}
            onClick={() => onOpenThread(open ? null : thread.id)}
            style={{
              position: "absolute",
              // The pin's tip marks the anchor point, so the button is offset up by its own height
              // rather than centred on it — a centred pin would read as pointing half a pin below.
              left: screen.x,
              top: screen.y - PIN_SIZE,
              width: PIN_SIZE,
              height: PIN_SIZE,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              // Rounded except at the bottom-left, which forms the tip that touches the anchor.
              borderRadius: "50% 50% 50% 2px",
              background: open ? "var(--dd-accent)" : "var(--dd-chrome-background-elevated)",
              color: open ? "var(--dd-chrome-background-elevated)" : "var(--dd-accent)",
              border: "1px solid var(--dd-accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              lineHeight: 1,
              // Above the canvas, below panels/menus — the same layer link badges occupy, so a pin
              // can never cover an open popover or panel.
              zIndex: 5,
            }}
          >
            {replies > 1 ? replies : <Icon name="comment" size={12} />}
          </button>
        );
      })}
      {openThread && !openThread.isDeleted && (
        <CommentThreadPopover scene={scene} thread={openThread} position={popoverPosition} readOnly={readOnly} onClose={() => onOpenThread(null)} />
      )}
    </>
  );
}

/** The popover sits just right of and below the pin's tip, so it never covers the shape being discussed. */
function offsetFromPin(pinScreen: { x: number; y: number }): { x: number; y: number } {
  return { x: pinScreen.x + PIN_SIZE + POPOVER_GAP_PX, y: pinScreen.y - PIN_SIZE };
}
