/**
 * "Mermaid to diagram" dialog (Excalidraw parity, no LLM): paste Mermaid flowchart text and insert it
 * as editable Deviva shapes. Parsing/layout lives in the engine (`mermaidToElements`); this is the
 * control surface. Inserted elements go through `insertElements` (fresh ids) offset to the viewport
 * center, in one history batch, and are selected so they can be moved/tweaked immediately.
 */
import { computeElementsBounds, insertElements, mermaidToElements, screenToScene } from "@deviva-draw/engine";
import { useState } from "react";
import { buttonStyle, dialogOverlayStyle, dialogStyle, inputStyle, labelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

const EXAMPLE = `flowchart TD
  A[Start] --> B{Ready?}
  B -->|yes| C[Ship it]
  B -->|no| D[Keep working]
  D --> B`;

export function MermaidDialog(props: { runtime: DevivaRuntime; cameraStore: CameraStore; getViewportSize(): { width: number; height: number }; onClose(): void }) {
  const { runtime, cameraStore, getViewportSize, onClose } = props;
  const { t } = useTranslation();
  const [source, setSource] = useState(EXAMPLE);

  const insert = () => {
    const elements = mermaidToElements(source);
    if (elements.length === 0) return;
    const bounds = computeElementsBounds(elements);
    if (!bounds) return;
    const { width, height } = getViewportSize();
    const center = screenToScene({ x: width / 2, y: height / 2 }, cameraStore.getCamera());
    const offset = { dx: center.x - (bounds.x + bounds.width / 2), dy: center.y - (bounds.y + bounds.height / 2) };
    runtime.history.beginBatch();
    const newIds = insertElements(runtime.scene, elements, offset);
    runtime.history.endBatch(runtime.scene.getElements());
    if (newIds.length > 0) runtime.selection.selectOnly(newIds);
    onClose();
  };

  return (
    <div style={dialogOverlayStyle} onClick={onClose} data-testid="mermaid-dialog-overlay">
      <div style={{ ...dialogStyle, width: 420 }} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={t("mermaid.title")} data-testid="mermaid-dialog">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong>{t("mermaid.title")}</strong>
          <button type="button" aria-label={t("shortcuts.close")} onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Icon name="close" />
          </button>
        </div>
        <span style={labelStyle}>{t("mermaid.description")}</span>
        <textarea
          data-testid="mermaid-input"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
          style={{ ...inputStyle, width: "100%", height: 180, marginTop: 6, marginBottom: 10, fontFamily: "monospace", fontSize: 12, resize: "vertical", boxSizing: "border-box" }}
        />
        <button type="button" data-testid="mermaid-insert" style={{ ...buttonStyle(false), width: "100%", justifyContent: "center" }} onClick={insert}>
          {t("mermaid.insert")}
        </button>
      </div>
    </div>
  );
}
