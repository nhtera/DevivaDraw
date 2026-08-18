/**
 * "Insert embed" dialog: paste a URL from an allowlisted provider (YouTube, Vimeo, Figma,
 * CodeSandbox) and drop it as a live embed element at the viewport center. Only embeddable URLs
 * enable the button — arbitrary sites are refused (see engine `resolveEmbed`). The element renders as
 * a placeholder card on the canvas plus a sandboxed iframe overlay (see `embed-overlay.tsx`).
 */
import { createEmbedElement, DEFAULT_EMBED_HEIGHT, DEFAULT_EMBED_WIDTH, isEmbeddable, screenToScene } from "@deviva-draw/engine";
import { useState } from "react";
import { buttonStyle, dialogOverlayStyle, dialogStyle, inputStyle, labelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useEscapeToClose } from "../hooks/use-escape-to-close";
import { useTranslation } from "../i18n/use-translation";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

export function EmbedDialog(props: { runtime: DevivaRuntime; cameraStore: CameraStore; getViewportSize(): { width: number; height: number }; onClose(): void }) {
  const { runtime, cameraStore, getViewportSize, onClose } = props;
  const { t } = useTranslation();
  useEscapeToClose(onClose);
  const [url, setUrl] = useState("");
  const valid = isEmbeddable(url);

  const insert = () => {
    if (!valid) return;
    const { width, height } = getViewportSize();
    const center = screenToScene({ x: width / 2, y: height / 2 }, cameraStore.getCamera());
    const element = createEmbedElement({ url: url.trim(), x: center.x - DEFAULT_EMBED_WIDTH / 2, y: center.y - DEFAULT_EMBED_HEIGHT / 2, width: DEFAULT_EMBED_WIDTH, height: DEFAULT_EMBED_HEIGHT });
    runtime.history.beginBatch();
    runtime.scene.addElement(element);
    runtime.history.endBatch(runtime.scene.getElements());
    runtime.selection.selectOnly([element.id]);
    onClose();
  };

  return (
    <div style={dialogOverlayStyle} onClick={onClose} data-testid="embed-dialog-overlay">
      <div style={{ ...dialogStyle, width: 400 }} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={t("embed.title")} data-testid="embed-dialog">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong>{t("embed.title")}</strong>
          <button type="button" aria-label={t("shortcuts.close")} onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Icon name="close" />
          </button>
        </div>
        <span style={labelStyle}>{t("embed.description")}</span>
        <input
          data-testid="embed-input"
          value={url}
          autoFocus
          placeholder="https://youtube.com/watch?v=…"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") insert();
          }}
          style={{ ...inputStyle, width: "100%", marginTop: 6, marginBottom: 10, boxSizing: "border-box" }}
        />
        <button type="button" data-testid="embed-insert" disabled={!valid} style={{ ...buttonStyle(false), width: "100%", justifyContent: "center", opacity: valid ? 1 : 0.5 }} onClick={insert}>
          {t("embed.insert")}
        </button>
      </div>
    </div>
  );
}
