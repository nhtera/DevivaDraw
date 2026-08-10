/**
 * Live embed layer: one sandboxed `<iframe>` per `EmbedElement`, positioned in screen space over the
 * canvas placeholder and kept in sync with the camera. Only allowlisted providers get an iframe (see
 * engine `resolveEmbed`); anything else stays a placeholder card. Pointer events are off by default —
 * so clicking an embed selects/moves it and you can draw over it — and switch on only while that embed
 * is the sole selection under the select tool, so you can then interact with the content (play the
 * video, scroll the Figma file). The iframe is sandboxed; no `allow-top-navigation`, so framed content
 * can't navigate the host away.
 */
import { resolveEmbed, sceneToScreen } from "@deviva-draw/engine";
import type { EmbedElement } from "@deviva-draw/engine";
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

  const camera = cameraStore.getCamera();
  const selectTool = runtime.toolStateMachine.getActiveToolName() === SELECT_TOOL_NAME;
  const selectedIds = runtime.selection.getSelectedIds();
  const embeds = runtime.scene.getElements().filter((element): element is EmbedElement => !element.isDeleted && element.type === "embed");
  if (embeds.length === 0) return null;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 5 }} data-testid="embed-overlay">
      {embeds.map((embed) => {
        const resolved = resolveEmbed(embed.url);
        if (!resolved) return null; // non-allowlisted → the canvas placeholder is the whole story
        const topLeft = sceneToScreen({ x: embed.x, y: embed.y }, camera);
        const interactive = selectTool && selectedIds.size === 1 && selectedIds.has(embed.id);
        return (
          <iframe
            key={embed.id}
            data-testid="embed-iframe"
            title={embed.url}
            src={resolved.embedUrl}
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            style={{
              position: "absolute",
              left: topLeft.x,
              top: topLeft.y,
              width: embed.width * camera.zoom,
              height: embed.height * camera.zoom,
              border: "none",
              borderRadius: 10 * camera.zoom,
              opacity: Math.min(1, Math.max(0, embed.opacity / 100)),
              pointerEvents: interactive ? "auto" : "none",
            }}
          />
        );
      })}
    </div>
  );
}
