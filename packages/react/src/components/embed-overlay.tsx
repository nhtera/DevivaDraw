/**
 * Live embed layer for `EmbedElement`s, positioned in screen space over the canvas placeholder and
 * kept in sync with the camera.
 *
 * Interaction model (matches Excalidraw & tldraw): by default an embed shows a **static poster**, not
 * a live frame. A poster is a plain `<img>` (or, for providers without a thumbnail, the canvas
 * placeholder card underneath) — it never captures pointer events, so selecting, dragging, resizing
 * and rotating the embed always work. To actually use the content (play the video, scroll the Figma
 * file) you deliberately **activate** it via the Interact toggle; only then is the sandboxed
 * `<iframe>` mounted and given pointer events. Selecting something else returns it to the poster.
 *
 * Why not always mount the iframe: a board with N embeds would otherwise run N live cross-origin
 * frames (CPU/network), and a frame under the cursor is exactly what used to steal a drag. Poster-by-
 * default removes both. The iframe is sandboxed with no top-navigation, so framed content can't
 * navigate the host away.
 */
import { resolveEmbed, sceneToScreen } from "@deviva-draw/engine";
import type { EmbedElement } from "@deviva-draw/engine";
import { Fragment, useEffect, useState } from "react";
import { SELECT_TOOL_NAME } from "../runtime/tool-names";
import { useCameraVersion, useSceneVersion, useSelectionVersion, useToolVersion } from "../runtime/use-live-version";
import { useTranslation } from "../i18n/use-translation";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

export function EmbedOverlay(props: { runtime: DevivaRuntime; cameraStore: CameraStore }) {
  const { runtime, cameraStore } = props;
  const { t } = useTranslation();
  useSceneVersion(runtime.scene);
  useSelectionVersion(runtime.selection);
  useToolVersion(runtime.toolStateMachine);
  useCameraVersion(cameraStore);
  const [activeId, setActiveId] = useState<string | null>(null);

  const camera = cameraStore.getCamera();
  const selectTool = runtime.toolStateMachine.getActiveToolName() === SELECT_TOOL_NAME;
  const selectedIds = runtime.selection.getSelectedIds();
  const soleSelected = selectTool && selectedIds.size === 1 ? [...selectedIds][0] ?? null : null;

  // Leaving "interact mode" whenever the sole-selected embed changes (including deselection) — so a
  // re-selected embed shows its poster again by default, not still-live.
  useEffect(() => setActiveId(null), [soleSelected]);

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
        const isSole = soleSelected === embed.id;
        const interactive = isSole && activeId === embed.id;
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
        // Play badge sits at the (rotation-invariant) center of the poster.
        const badgeR = Math.max(14, Math.min(30, height * 0.16));
        return (
          <Fragment key={embed.id}>
            {interactive ? (
              <iframe
                data-testid="embed-iframe"
                title={embed.url}
                src={resolved.embedUrl}
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
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

            {!interactive && resolved.previewUrl && (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: topLeft.x + width / 2 - badgeR,
                  top: topLeft.y + height / 2 - badgeR,
                  width: badgeR * 2,
                  height: badgeR * 2,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: badgeR,
                  paddingLeft: badgeR * 0.12,
                  pointerEvents: "none",
                }}
              >
                ▶
              </div>
            )}

            {isSole && (
              <button
                type="button"
                data-testid="embed-interact-toggle"
                // Native `stopPropagation` (not React's synthetic one): the engine's pointer pipeline
                // is a native bubble-phase listener on the canvas host, which fires before React's
                // delegated events — so a synthetic handler can't stop it, and a plain click here would
                // otherwise reach the canvas and deselect the embed. Node-scoped listeners die with the node.
                ref={(node) => {
                  if (!node || node.dataset.bound) return;
                  node.dataset.bound = "1";
                  const stop = (event: Event) => event.stopPropagation();
                  node.addEventListener("pointerdown", stop);
                  node.addEventListener("pointerup", stop);
                }}
                onClick={() => setActiveId(interactive ? null : embed.id)}
                style={{
                  // Positioned INSIDE the embed's top-right so a click on it hit-tests as an interior
                  // click on the (already-selected) embed and keeps it selected, rather than landing on
                  // empty canvas above the embed and deselecting it.
                  position: "absolute",
                  left: Math.max(topLeft.x + 6, topLeft.x + width - 90),
                  top: topLeft.y + 6,
                  pointerEvents: "auto",
                  fontSize: 12,
                  padding: "3px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--dd-chrome-border)",
                  background: "var(--dd-chrome-background-elevated)",
                  color: "var(--dd-text-primary)",
                  cursor: "pointer",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                }}
              >
                {interactive ? t("embed.done") : t("embed.interact")}
              </button>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
