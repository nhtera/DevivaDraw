/**
 * Presentation mode: frames become slides, and the camera walks them.
 *
 * Assembled from pieces the editor already has rather than a parallel rendering path — frames for
 * the slide regions, the laser tool for pointing, view-only to make the board un-editable mid-talk,
 * and phase-1's `panelsHidden` chrome split for the clean stage. This component owns only the walk:
 * which slide is current, the camera animation between them, and the keyboard. The control bar lives
 * in `presentation-hud.tsx`, which holds no state of its own.
 *
 * The camera aims at exactly the destination `PanZoomTool.revealRect` would jump to — both call the
 * engine's `computeRevealRectCamera` — and animates there with the engine's easing/interpolation
 * helpers. The `requestAnimationFrame` loop lives here rather than in the engine because the engine
 * owns no timers; the math it does own is not duplicated.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { computeRevealRectCamera, easeInOutCubic, interpolateCamera } from "@deviva-draw/engine";
import type { Camera, FrameElement, SceneRect } from "@deviva-draw/engine";
import { Z_LAYER } from "../chrome-styles";
import { orderFramesAsSlides, orderedSceneFrames } from "./frame-slide-order";
import type { Slide } from "./frame-slide-order";
import { PresentationHud } from "./presentation-hud";
import { FloatingReactions, RaisedHandsList } from "./presentation-reactions";
import { PresenterNotesPanel } from "./presenter-notes-panel";
import { useSuspendedEditorState } from "./use-suspended-editor-state";
import { useTranslation } from "../../i18n/use-translation";
import { useSceneVersion } from "../../runtime/use-live-version";
import { raisedHands, usePeerReactions } from "../../hooks/use-peer-reactions";
import type { UseCollabSessionResult } from "../../hooks/use-collab-session";
import type { CameraStore } from "../../runtime/camera-store";
import type { DevivaRuntime } from "../../runtime/runtime-types";

/** Slide-transition duration. Long enough to read as movement between two places, short enough not to be a wait. */
const TRANSITION_MS = 420;

/** Stable empty list, so `usePeerReactions`' effect does not re-run every render in a host with no collab session. */
const EMPTY_PEERS: never[] = [];

/**
 * Asks the browser for real fullscreen, tolerating every way it can decline.
 *
 * `requestFullscreen` rejects when the call is not user-activated, and is absent entirely in some
 * embedding contexts (an iframe without `allow="fullscreen"`). Neither is an error worth surfacing:
 * presentation already hides the editor chrome by itself, so a denied request degrades to a windowed
 * presentation that still works — which is also the path the e2e spec exercises, since headless
 * Chromium has no real fullscreen to enter.
 */
async function tryEnterFullscreen(element: HTMLElement): Promise<void> {
  try {
    if (typeof element.requestFullscreen === "function" && !document.fullscreenElement) await element.requestFullscreen({ navigationUI: "hide" });
  } catch {
    // Windowed presentation is a perfectly good fallback — see this function's doc.
  }
}

async function tryExitFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === "function") await document.exitFullscreen();
  } catch {
    // Nothing to recover: the mode is already leaving.
  }
}

export interface PresentationControllerProps {
  runtime: DevivaRuntime;
  cameraStore: CameraStore;
  getViewportSize(): { width: number; height: number };
  /** Leaves presentation mode — the shell owns the flag, this component only asks. */
  onExit(): void;
  /** The live collaboration session, when the host has one. Absent (or disconnected) hides the reaction bar entirely — reacting to yourself is not a feature. */
  collab?: UseCollabSessionResult;
}

/** The frames of `runtime`'s scene, in slide order. */
export function slidesOf(runtime: DevivaRuntime): Slide[] {
  const frames = orderedSceneFrames(runtime.scene.getElements()).map((frame) => ({ id: frame.id, name: (frame as { name?: string }).name ?? "" }));
  return orderFramesAsSlides(frames);
}

export function PresentationController(props: PresentationControllerProps) {
  const { runtime, cameraStore, getViewportSize, onExit, collab } = props;
  const { t } = useTranslation();
  // Re-derive the deck when the scene changes: a frame renamed or deleted mid-presentation must not
  // leave the walk pointing at something that no longer exists.
  const sceneVersion = useSceneVersion(runtime.scene);
  const [slides, setSlides] = useState<Slide[]>(() => slidesOf(runtime));
  const [index, setIndex] = useState(0);
  // Off by default — see `presenter-notes-panel.tsx` for why the strip is opt-in rather than always-on.
  const [notesVisible, setNotesVisible] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const animationRef = useRef<number | null>(null);

  const connected = collab?.status === "connected";
  const peers = collab?.peers ?? EMPTY_PEERS;
  const reactions = usePeerReactions(peers);
  const hands = raisedHands(peers);

  // Selection and tool are the editor's, not the presentation's — borrowed here, returned on exit.
  useSuspendedEditorState(runtime);

  useEffect(() => {
    const next = slidesOf(runtime);
    setSlides(next);
    setIndex((current) => Math.min(current, Math.max(0, next.length - 1)));
  }, [runtime, sceneVersion]);

  /** Animates the camera to `rect` over `TRANSITION_MS`, replacing any transition already running. */
  const animateTo = useCallback(
    (rect: SceneRect, immediate: boolean) => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      const from = cameraStore.getCamera();
      const target: Camera = computeRevealRectCamera(from, rect, getViewportSize());
      if (immediate) {
        cameraStore.setCamera(target);
        return;
      }
      const started = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - started) / TRANSITION_MS);
        cameraStore.setCamera(interpolateCamera(from, target, easeInOutCubic(progress)));
        animationRef.current = progress < 1 ? requestAnimationFrame(step) : null;
      };
      animationRef.current = requestAnimationFrame(step);
    },
    [cameraStore, getViewportSize],
  );

  /** The current slide's frame rect, or `null` if it vanished from the scene. */
  const rectForIndex = useCallback(
    (slideIndex: number): SceneRect | null => {
      const slide = slides[slideIndex];
      if (!slide) return null;
      const frame = runtime.scene.getElement(slide.id);
      if (!frame || frame.isDeleted) return null;
      return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    },
    [runtime.scene, slides],
  );

  // Entering: jump — not animate — to the first slide, since there is no previous camera position
  // worth travelling from. The laser tool is picked by `useSuspendedEditorState`, which also puts the
  // previous tool back; see there for why the two halves must not be split across effects.
  const enteredRef = useRef(false);
  useEffect(() => {
    if (enteredRef.current || slides.length === 0) return;
    enteredRef.current = true;
    void tryEnterFullscreen(document.documentElement);
    const rect = rectForIndex(0);
    if (rect) animateTo(rect, true);
  }, [slides.length, rectForIndex, animateTo]);

  // Every later slide change animates.
  const previousIndexRef = useRef(0);
  useEffect(() => {
    if (previousIndexRef.current === index) return;
    previousIndexRef.current = index;
    const rect = rectForIndex(index);
    if (rect) animateTo(rect, false);
  }, [index, rectForIndex, animateTo]);

  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
  }, []);

  // Leaving fullscreen by the browser's own affordance (its Escape, the macOS green button) must leave
  // presentation too — otherwise the chrome stays hidden with no visible reason and the user is stuck
  // in a mode they believe they just exited.
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) onExit();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [onExit]);

  // Any exit path releases fullscreen.
  useEffect(() => () => void tryExitFullscreen(), []);

  // A raised hand is an ask about the talk, so it must not outlive the talk: leaving presentation (or
  // losing the session) lowers it for everyone rather than leaving a hand up on other peers' screens.
  const collabSetHandRaised = collab?.setHandRaised;
  useEffect(() => {
    if (connected) return;
    setHandRaised(false);
  }, [connected]);
  useEffect(
    () => () => {
      setHandRaised(false);
      collabSetHandRaised?.(false);
    },
    [collabSetHandRaised],
  );

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(Math.max(0, current + delta), Math.max(0, slides.length - 1)));
    },
    [slides.length],
  );

  // Capture-phase, and `preventDefault` on every key it claims: Space would otherwise scroll the
  // page and the arrows would reach the select tool's own nudge handler. Presentation is view-only,
  // so no text editor can be open to compete for these keys — asserted in the e2e spec.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const forward = event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ";
      const back = event.key === "ArrowLeft" || event.key === "PageUp";
      // `n` is the note tool's letter in the editor. Claiming it here is safe precisely because this
      // handler is capture-phase and consumes what it claims — and because the listener is removed on
      // exit, so the note tool gets its letter back the moment presentation ends.
      const toggleNotes = event.key === "n" || event.key === "N";
      if (!forward && !back && !toggleNotes && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") onExit();
      else if (toggleNotes) setNotesVisible((visible) => !visible);
      else go(forward ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [go, onExit]);

  const current = slides[index];
  // Read through the scene rather than caching on the slide: notes edited (or arriving over collab)
  // mid-presentation should show up on the next render, and `sceneVersion` is already a dependency.
  const currentElement = current ? runtime.scene.getElement(current.id) : undefined;
  const currentNotes = currentElement && !currentElement.isDeleted && currentElement.type === "frame" ? ((currentElement as FrameElement).notes ?? "") : "";

  return (
    <div data-testid="presentation-overlay" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: Z_LAYER.menu }}>
      {/* The camera is sampled per render, so a reaction's screen position is fixed when it appears and
          does not track a slide transition already in flight. Following the camera would mean a second
          rAF loop for something that lives under three seconds and is animating away from its anchor
          the whole time. */}
      <FloatingReactions reactions={reactions} camera={cameraStore.getCamera()} viewport={getViewportSize()} />
      {connected && <RaisedHandsList peers={hands} label={t("presentation.raisedHands")} />}
      {notesVisible && <PresenterNotesPanel notes={currentNotes} label={t("presentation.notes")} emptyLabel={t("presentation.notesEmpty")} />}
      <PresentationHud
        slides={slides}
        index={index}
        onGo={go}
        notesVisible={notesVisible}
        onToggleNotes={() => setNotesVisible((visible) => !visible)}
        handRaised={handRaised}
        onToggleHand={() => {
          const next = !handRaised;
          setHandRaised(next);
          collab?.setHandRaised(next);
        }}
        collab={connected && collab ? collab : null}
        onExit={onExit}
      />
    </div>
  );
}
