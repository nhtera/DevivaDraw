/**
 * The two halves of viewport sharing: publishing where this client is looking, and (when following
 * someone) putting the local camera where they are looking.
 *
 * They live in one file because they are inverse functions of the same wire shape — `PresenceViewport`
 * is the scene point at the centre of a screen plus a zoom (see its doc in `@deviva-draw/collab-client`),
 * and getting the two conversions out of sync is exactly the bug that makes follow-mode drift. The
 * conversions are exported as pure functions so they can be unit-tested in a package that does not
 * test hooks (see `runtime/use-live-version.ts`'s module doc for why).
 *
 * Breaking follow on a local gesture is centralised here rather than sprinkled across the pan/zoom
 * handlers: the hook remembers the camera it last wrote and treats any camera it did not author as
 * the user taking their view back. That covers every gesture — drag-pan, wheel, pinch, the zoom menu,
 * back-to-content, a keyboard nudge — including ones added later, because none of them can move the
 * camera without going through `CameraStore.setCamera`.
 */
import { useEffect, useRef } from "react";
import { clampZoom } from "@deviva-draw/engine";
import type { Camera } from "@deviva-draw/engine";
import type { PresenceViewport } from "@deviva-draw/collab-client";
import type { CameraStore } from "../runtime/camera-store";

export interface ViewportSize {
  width: number;
  height: number;
}

/** What this client is looking at, in the wire's terms: the scene point under the centre of the viewport, plus the zoom. */
export function cameraToViewport(camera: Camera, size: ViewportSize): PresenceViewport {
  return {
    x: size.width / (2 * camera.zoom) - camera.scrollX,
    y: size.height / (2 * camera.zoom) - camera.scrollY,
    zoom: camera.zoom,
  };
}

/**
 * The inverse: the camera that puts `viewport`'s centre point under the centre of a `size` viewport.
 *
 * Returns `null` for anything non-finite. Presence is attacker-controllable input, and while
 * `isPlausiblePresencePayload` checks the fields are numbers, `NaN` and `Infinity` *are* numbers — and
 * a single non-finite camera write is unrecoverable by hand, since every later pan is arithmetic on
 * `NaN`. A dropped follow frame is a far cheaper failure than a bricked canvas.
 */
export function viewportToCamera(viewport: PresenceViewport, size: ViewportSize): Camera | null {
  if (![viewport.x, viewport.y, viewport.zoom].every((value) => Number.isFinite(value))) return null;
  const zoom = clampZoom(viewport.zoom);
  return { zoom, scrollX: size.width / (2 * zoom) - viewport.x, scrollY: size.height / (2 * zoom) - viewport.y };
}

/**
 * Whether `current` is the camera this hook last wrote — i.e. whether the change that just fired is
 * its own echo rather than the user taking over.
 *
 * Compared by value, not identity: `CameraStore.setCamera` drops a write that changes nothing, so a
 * followed peer republishing the same viewport leaves the store holding the *previous* object while
 * the hook holds a fresh equal one. An identity check would read that as a foreign change and break
 * follow the moment the presenter stopped moving — the exact opposite of what should happen.
 */
export function isAuthoredCamera(written: Camera | null, current: Camera): boolean {
  if (!written) return false;
  return written.scrollX === current.scrollX && written.scrollY === current.scrollY && written.zoom === current.zoom;
}

export interface UsePublishLocalViewportOptions {
  cameraStore: CameraStore;
  getViewportSize(): ViewportSize;
  /** `CollabSession.setLocalViewport` — throttles and de-duplicates internally, so this hook may call it on every camera change. */
  publish(viewport: PresenceViewport | null): void;
  /** Publishing is pointless while disconnected, and clearing on the way out keeps a stale viewport from riding the next session's first broadcast. */
  active: boolean;
}

/** Publishes the local camera as a `PresenceViewport` on every camera change, so peers can follow this client. */
export function usePublishLocalViewport(options: UsePublishLocalViewportOptions): void {
  const { cameraStore, getViewportSize, publish, active } = options;
  useEffect(() => {
    if (!active) {
      publish(null);
      return;
    }
    const send = () => publish(cameraToViewport(cameraStore.getCamera(), getViewportSize()));
    send(); // the current view, not just the next change — a peer joining a still canvas has to see something
    return cameraStore.subscribe(send);
  }, [cameraStore, getViewportSize, publish, active]);
}

export interface UseFollowPeerCameraOptions {
  cameraStore: CameraStore;
  getViewportSize(): ViewportSize;
  /** The followed peer's latest viewport, or `null` when not following (or when they have not published one yet). */
  viewport: PresenceViewport | null;
  /** Called when a camera change this hook did not author is observed — the user has taken over, so following must stop. */
  onBreak(): void;
}

/** Drives the local camera from a followed peer's viewport, and reports the moment the user moves it themselves. */
export function useFollowPeerCamera(options: UseFollowPeerCameraOptions): void {
  const { cameraStore, getViewportSize, viewport, onBreak } = options;
  // The exact camera object this hook last wrote. Compared by value, not identity: `setCamera` ignores
  // a write that changes nothing, so an identity check would miss the no-op case entirely.
  const writtenRef = useRef<Camera | null>(null);
  const following = viewport !== null;

  useEffect(() => {
    if (!following) {
      writtenRef.current = null;
      return;
    }
    return cameraStore.subscribe(() => {
      if (isAuthoredCamera(writtenRef.current, cameraStore.getCamera())) return;
      onBreak();
    });
  }, [cameraStore, following, onBreak]);

  useEffect(() => {
    if (!viewport) return;
    const target = viewportToCamera(viewport, getViewportSize());
    if (!target) return;
    // Recorded BEFORE the write: `setCamera` notifies synchronously, so the break-detection listener
    // above runs inside this call and must already see this camera as authored.
    writtenRef.current = target;
    cameraStore.setCamera(target);
  }, [cameraStore, getViewportSize, viewport]);
}
