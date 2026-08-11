/**
 * Live embed layer for `EmbedElement`s, positioned in screen space over the canvas placeholder and
 * kept in sync with the camera. Follows Excalidraw's embed model exactly:
 *
 * - The sandboxed `<iframe>` is always mounted so the real content (a YouTube player, a Figma file) is
 *   what you see. While the embed is NOT "active" the iframe is `pointer-events: none`, so every click
 *   and drag falls straight through to the canvas — you select, move, resize and rotate it from
 *   anywhere, with nothing under the cursor to fight. A **"Click to interact"** overlay is shown on the
 *   selected embed as the affordance (also click-through — it's purely a label).
 * - You **activate** it by clicking the already-selected embed (Excalidraw's click-to-select-then-click-
 *   to-interact), or by double-clicking (handled in `double-click-edit`). Only then does the iframe take
 *   pointer events. You leave by clicking away (deselecting) or pressing Escape.
 *
 * Activation is detected from window pointer events (a tap — no drag — on the embed that was already
 * the sole selection) rather than a DOM click handler on the overlay: the engine sets pointer capture
 * on the canvas host during a gesture, so a tap is the reliable signal and it never interferes with the
 * drag-to-move path. The iframe is sandboxed with no top-navigation, so framed content can't navigate
 * the host away.
 */
import { hitTestElement, resolveEmbed, sceneToScreen, screenToScene } from "@deviva-draw/engine";
import type { EmbedElement } from "@deviva-draw/engine";
import { Fragment, useEffect, useRef, useState } from "react";
import { chromeFontFamily } from "./chrome-styles";
import { SELECT_TOOL_NAME } from "../runtime/tool-names";
import { useCameraVersion, useSceneVersion, useSelectionVersion, useToolVersion } from "../runtime/use-live-version";
import { useTranslation } from "../i18n/use-translation";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

/** Max pointer travel (screen px) between down and up that still counts as a tap, not a drag. */
const TAP_SLOP = 5;

export function EmbedOverlay(props: { runtime: DevivaRuntime; cameraStore: CameraStore }) {
  const { runtime, cameraStore } = props;
  const { t } = useTranslation();
  useSceneVersion(runtime.scene);
  useSelectionVersion(runtime.selection);
  useToolVersion(runtime.toolStateMachine);
  useCameraVersion(cameraStore);
  const [activeId, setActiveId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const camera = cameraStore.getCamera();
  const selectTool = runtime.toolStateMachine.getActiveToolName() === SELECT_TOOL_NAME;
  const selectedIds = runtime.selection.getSelectedIds();
  const soleSelected = selectTool && selectedIds.size === 1 ? [...selectedIds][0] ?? null : null;

  const activate = (id: string) => {
    runtime.selection.selectOnly([id]);
    setActiveId(id);
  };

  // The sole-selected element's id if (and only if) it is an embed — else null.
  const soleEmbedId = (): string | null => {
    const ids = [...runtime.selection.getSelectedIds()];
    if (ids.length !== 1) return null;
    const el = runtime.scene.getElements().find((e) => e.id === ids[0]);
    return el && !el.isDeleted && el.type === "embed" ? el.id : null;
  };

  // Activation + exit gestures. A tap (no drag) on the embed that was already the sole selection enters
  // interact mode; double-click does too (via the engine dblclick handler's event); Escape leaves.
  useEffect(() => {
    let down: { x: number; y: number; sole: string | null; inHost: boolean } | null = null;

    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      down = {
        x: event.clientX,
        y: event.clientY,
        sole: soleEmbedId(), // captured pre-engine (capture phase) so it's the selection *before* this click
        inHost: !!target?.closest?.('[data-testid="deviva-draw-canvas-host"]'),
      };
    };
    const onUp = (event: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || !d.sole || !d.inHost) return;
      if (Math.hypot(event.clientX - d.x, event.clientY - d.y) > TAP_SLOP) return; // a drag/resize/rotate, not a tap
      // Confirm the tap actually landed on that embed and it's still the sole selection.
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scenePoint = screenToScene({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraStore.getCamera());
      const el = runtime.scene.getElements().find((e) => e.id === d.sole);
      if (soleEmbedId() === d.sole && el && hitTestElement(el, scenePoint, 6 / cameraStore.getCamera().zoom)) activate(d.sole);
    };
    const onActivate = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (id) activate(id);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveId(null);
    };

    window.addEventListener("pointerdown", onDown, true); // capture: read selection before the engine mutates it
    window.addEventListener("pointerup", onUp); // bubble: read selection after the engine has finalized it
    window.addEventListener("deviva:embed-activate", onActivate);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("deviva:embed-activate", onActivate);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [runtime, cameraStore]);

  // Leave interact mode once the active embed is no longer the sole selection (clicked away / another
  // element selected). Guarded so programmatic select-on-activate doesn't immediately clear itself.
  useEffect(() => {
    if (activeId !== null && soleSelected !== activeId) setActiveId(null);
  }, [soleSelected, activeId]);

  const embeds = runtime.scene.getElements().filter((element): element is EmbedElement => !element.isDeleted && element.type === "embed");
  if (embeds.length === 0) return null;

  return (
    <div ref={rootRef} style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 5 }} data-testid="embed-overlay">
      {embeds.map((embed) => {
        const resolved = resolveEmbed(embed.url);
        if (!resolved) return null; // non-allowlisted → the canvas placeholder is the whole story
        const topLeft = sceneToScreen({ x: embed.x, y: embed.y }, camera);
        const interactive = activeId === embed.id;
        const isSole = soleSelected === embed.id;
        // When you click "Click to interact" the video should just play — not require a second click on
        // YouTube's own play button. Activating swaps the frame's src to an autoplay URL; the activating
        // click is a user gesture and `allow="autoplay"` delegates the permission into the frame, so a
        // video provider starts playing on that single click. Idle (non-active) shows the plain poster.
        const isVideo = resolved.provider === "youtube" || resolved.provider === "vimeo";
        const src = interactive && isVideo ? `${resolved.embedUrl}?autoplay=1` : resolved.embedUrl;
        // Element is rotated around its center, exactly like the canvas placeholder.
        const boxStyle = {
          position: "absolute" as const,
          left: topLeft.x,
          top: topLeft.y,
          width: embed.width * camera.zoom,
          height: embed.height * camera.zoom,
          border: "none",
          borderRadius: 10 * camera.zoom,
          transform: embed.angle ? `rotate(${embed.angle}rad)` : undefined,
          transformOrigin: "center",
          opacity: Math.min(1, Math.max(0, embed.opacity / 100)),
        };
        return (
          <Fragment key={embed.id}>
            <iframe
              data-testid="embed-iframe"
              title={embed.url}
              src={src}
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              // Click-through until activated, so select/move/resize/rotate always reach the canvas.
              style={{ ...boxStyle, pointerEvents: interactive ? "auto" : "none" }}
            />
            {!interactive && isSole && (
              <div
                data-testid="embed-interact-overlay"
                aria-hidden
                // Purely a label — click-through (`pointer-events: none`) so it never blocks a drag.
                // Activation is handled by the window tap-detector above.
                style={{
                  ...boxStyle,
                  pointerEvents: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  background: "rgba(0,0,0,0.45)",
                  color: "#fff",
                  fontFamily: chromeFontFamily,
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: 0.2,
                  textShadow: "0 1px 4px rgba(0,0,0,0.7)",
                }}
              >
                <span aria-hidden style={{ fontSize: 13, filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.7))" }}>▶</span>
                {t("embed.interact")}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
