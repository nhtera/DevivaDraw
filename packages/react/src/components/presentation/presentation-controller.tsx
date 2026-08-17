/**
 * Presentation mode: frames become slides, and the camera walks them.
 *
 * Assembled from pieces the editor already has rather than a parallel rendering path — frames for
 * the slide regions, the laser tool for pointing, view-only to make the board un-editable mid-talk,
 * and phase-1's `panelsHidden` chrome split for the clean stage. This component owns only the walk:
 * which slide is current, the camera animation between them, the keyboard, and the HUD.
 *
 * The camera aims at exactly the destination `PanZoomTool.revealRect` would jump to — both call the
 * engine's `computeRevealRectCamera` — and animates there with the engine's easing/interpolation
 * helpers. The `requestAnimationFrame` loop lives here rather than in the engine because the engine
 * owns no timers; the math it does own is not duplicated.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { computeRevealRectCamera, easeInOutCubic, interpolateCamera } from "@deviva-draw/engine";
import type { Camera, SceneRect } from "@deviva-draw/engine";
import { buttonStyle, panelStyle, Z_LAYER } from "../chrome-styles";
import { orderFramesAsSlides, orderedSceneFrames } from "./frame-slide-order";
import type { Slide } from "./frame-slide-order";
import { Icon } from "../icon";
import { useTranslation } from "../../i18n/use-translation";
import { useSceneVersion } from "../../runtime/use-live-version";
import { LASER_TOOL_NAME } from "../../runtime/tool-names";
import type { CameraStore } from "../../runtime/camera-store";
import type { DevivaRuntime } from "../../runtime/runtime-types";

/** Slide-transition duration. Long enough to read as movement between two places, short enough not to be a wait. */
const TRANSITION_MS = 420;

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
}

/** The frames of `runtime`'s scene, in slide order. */
export function slidesOf(runtime: DevivaRuntime): Slide[] {
  const frames = orderedSceneFrames(runtime.scene.getElements()).map((frame) => ({ id: frame.id, name: (frame as { name?: string }).name ?? "" }));
  return orderFramesAsSlides(frames);
}

export function PresentationController(props: PresentationControllerProps) {
  const { runtime, cameraStore, getViewportSize, onExit } = props;
  const { t } = useTranslation();
  // Re-derive the deck when the scene changes: a frame renamed or deleted mid-presentation must not
  // leave the walk pointing at something that no longer exists.
  const sceneVersion = useSceneVersion(runtime.scene);
  const [slides, setSlides] = useState<Slide[]>(() => slidesOf(runtime));
  const [index, setIndex] = useState(0);
  const animationRef = useRef<number | null>(null);

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

  // Entering: pick the laser tool (the pointing affordance a presenter reaches for) and jump — not
  // animate — to the first slide, since there is no previous camera position worth travelling from.
  const enteredRef = useRef(false);
  useEffect(() => {
    if (enteredRef.current || slides.length === 0) return;
    enteredRef.current = true;
    void tryEnterFullscreen(document.documentElement);
    runtime.toolStateMachine.setTool(LASER_TOOL_NAME);
    const rect = rectForIndex(0);
    if (rect) animateTo(rect, true);
  }, [slides.length, runtime, rectForIndex, animateTo]);

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
      if (!forward && !back && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") onExit();
      else go(forward ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [go, onExit]);

  const current = slides[index];

  return (
    <div data-testid="presentation-overlay" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: Z_LAYER.menu }}>
      <div
        data-testid="presentation-hud"
        style={{
          ...panelStyle,
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          width: "auto",
          height: "auto",
          pointerEvents: "auto",
        }}
      >
        <button type="button" data-testid="presentation-prev" aria-label={t("presentation.previous")} disabled={index === 0} style={buttonStyle(false)} onClick={() => go(-1)}>
          <Icon name="chevron-left" />
        </button>
        <span data-testid="presentation-counter" style={{ fontSize: 12, minWidth: 44, textAlign: "center" }}>
          {slides.length === 0 ? "0 / 0" : `${index + 1} / ${slides.length}`}
        </span>
        <button
          type="button"
          data-testid="presentation-next"
          aria-label={t("presentation.next")}
          disabled={slides.length === 0 || index >= slides.length - 1}
          style={buttonStyle(false)}
          onClick={() => go(1)}
        >
          <Icon name="chevron-right" />
        </button>
        {current && (
          <span data-testid="presentation-slide-name" style={{ fontSize: 12, color: "var(--dd-text-secondary)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {current.name}
          </span>
        )}
        <button type="button" data-testid="presentation-exit" aria-label={t("presentation.exit")} title={t("presentation.exit")} style={buttonStyle(false)} onClick={onExit}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
