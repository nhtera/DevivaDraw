/**
 * Live embed layer for `EmbedElement`s, positioned in screen space over the canvas placeholder and
 * kept in sync with the camera.
 *
 * Interaction model (matches Excalidraw & tldraw): by default an embed shows a **static poster**, not
 * a live frame. A poster is a plain click-through `<img>` (or, for providers without a thumbnail, the
 * canvas placeholder card underneath) — it never captures pointer events, so selecting, dragging,
 * resizing and rotating the embed always work. To use the content you **activate** the embed — click
 * its play button (Excalidraw-style) or double-click it (tldraw-style, handled in `double-click-edit`);
 * only then is the sandboxed `<iframe>` mounted and given pointer events. You leave by clicking away
 * (deselecting) or pressing Escape — exactly like both competitors, and with no chrome button of our
 * own hanging off the element.
 *
 * Why not always mount the iframe: a board with N embeds would otherwise run N live cross-origin
 * frames (CPU/network), and a frame under the cursor is exactly what used to steal a drag. The iframe
 * is sandboxed with no top-navigation, so framed content can't navigate the host away.
 */
import { resolveEmbed, sceneToScreen } from "@deviva-draw/engine";
import type { EmbedElement } from "@deviva-draw/engine";
import { Fragment, useEffect, useState } from "react";
import { SELECT_TOOL_NAME } from "../runtime/tool-names";
import { useCameraVersion, useSceneVersion, useSelectionVersion, useToolVersion } from "../runtime/use-live-version";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

export function EmbedOverlay(props: { runtime: DevivaRuntime; cameraStore: CameraStore }) {
  const { runtime, cameraStore } = props;
  useSceneVersion(runtime.scene);
  useSelectionVersion(runtime.selection);
  useToolVersion(runtime.toolStateMachine);
  useCameraVersion(cameraStore);
  const [activeId, setActiveId] = useState<string | null>(null);

  const camera = cameraStore.getCamera();
  const selectTool = runtime.toolStateMachine.getActiveToolName() === SELECT_TOOL_NAME;
  const selectedIds = runtime.selection.getSelectedIds();
  const soleSelected = selectTool && selectedIds.size === 1 ? [...selectedIds][0] ?? null : null;

  const activate = (id: string) => {
    runtime.selection.selectOnly([id]);
    setActiveId(id);
  };

  // Double-click activation (dispatched by the engine-level dblclick handler once it identifies an
  // embed under the cursor) — tldraw parity, and works anywhere on the embed including a non-preview card.
  useEffect(() => {
    const onActivate = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (id) activate(id);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveId(null);
    };
    window.addEventListener("deviva:embed-activate", onActivate);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("deviva:embed-activate", onActivate);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [runtime]);

  // Leave interact mode once the active embed is no longer the sole selection (clicked away / another
  // element selected). Guarded so programmatic select-on-activate doesn't immediately clear itself.
  useEffect(() => {
    if (activeId !== null && soleSelected !== activeId) setActiveId(null);
  }, [soleSelected, activeId]);

  const embeds = runtime.scene.getElements().filter((element): element is EmbedElement => !element.isDeleted && element.type === "embed");
  if (embeds.length === 0) return null;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 5 }} data-testid="embed-overlay">
      {embeds.map((embed) => {
        const resolved = resolveEmbed(embed.url);
        if (!resolved) return null; // non-allowlisted → the canvas placeholder is the whole story
        const topLeft = sceneToScreen({ x: embed.x, y: embed.y }, camera);
        const width = embed.width * camera.zoom;
        const height = embed.height * camera.zoom;
        const interactive = activeId === embed.id;
        // One-click-to-play (beats Excalidraw's activate-then-press-play): activation mounts the frame
        // already playing. The click that mounts it is a user gesture and `allow="autoplay"` delegates
        // the permission into the frame, so a video provider autoplays with sound. Non-video providers
        // (Figma/CodeSandbox) get their plain embed URL.
        const isVideo = resolved.provider === "youtube" || resolved.provider === "vimeo";
        const liveSrc = isVideo ? `${resolved.embedUrl}?autoplay=1` : resolved.embedUrl;
        // Element is rotated around its center, exactly like the canvas placeholder.
        const boxStyle = {
          position: "absolute" as const,
          left: topLeft.x,
          top: topLeft.y,
          width,
          height,
          border: "none",
          borderRadius: 10 * camera.zoom,
          transform: embed.angle ? `rotate(${embed.angle}rad)` : undefined,
          transformOrigin: "center",
          opacity: Math.min(1, Math.max(0, embed.opacity / 100)),
        };
        // Play button lives at the (rotation-invariant) center; kept small so most of the poster stays
        // grabbable for dragging.
        const playR = Math.max(16, Math.min(30, height * 0.16));
        return (
          <Fragment key={embed.id}>
            {interactive ? (
              <iframe
                data-testid="embed-iframe"
                title={embed.url}
                src={liveSrc}
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{ ...boxStyle, pointerEvents: "auto" }}
              />
            ) : resolved.previewUrl ? (
              <img
                data-testid="embed-preview"
                src={resolved.previewUrl}
                alt=""
                draggable={false}
                // Poster is click-through so selecting/moving/resizing/rotating the embed always works.
                style={{ ...boxStyle, objectFit: "cover", background: "#000", pointerEvents: "none" }}
              />
            ) : null /* no thumbnail (Figma/CodeSandbox) → the canvas placeholder card shows through */}

            {!interactive && (
              <button
                type="button"
                data-testid="embed-play"
                aria-label="Play embed"
                // Native `stopPropagation` (not React's synthetic one): the engine's pointer pipeline is
                // a native bubble-phase listener on the canvas host and fires before React's delegated
                // events, so a synthetic handler can't stop it and a plain pointerdown here would reach
                // the canvas and start a marquee/deselect. We select + activate programmatically instead.
                ref={(node) => {
                  if (!node || node.dataset.bound) return;
                  node.dataset.bound = "1";
                  const stop = (event: Event) => event.stopPropagation();
                  node.addEventListener("pointerdown", stop);
                  node.addEventListener("pointerup", stop);
                }}
                onClick={() => activate(embed.id)}
                style={{
                  position: "absolute",
                  left: topLeft.x + width / 2 - playR,
                  top: topLeft.y + height / 2 - playR,
                  width: playR * 2,
                  height: playR * 2,
                  borderRadius: "50%",
                  border: "none",
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: playR,
                  paddingLeft: playR * 0.14,
                  cursor: "pointer",
                  pointerEvents: "auto",
                  boxShadow: "0 1px 6px rgba(0,0,0,0.35)",
                }}
              >
                ▶
              </button>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
