/**
 * "Mermaid to diagram" dialog (Excalidraw parity, no LLM): paste Mermaid text and insert it as editable
 * Deviva shapes. Parsing/layout lives in the engine (`tryMermaidToElements`); this is the control
 * surface. A debounced live preview (`MermaidPreview`) shows the parsed result as you type, and an
 * inline error appears for unsupported/unparseable input (Insert is disabled until there's something to
 * insert). Inserted elements go through `insertElements` (fresh ids) offset to the viewport center, in
 * one history batch, and are selected so they can be moved/tweaked immediately.
 */
import { computeElementsBounds, insertElements, screenToScene, tryMermaidToElements } from "@deviva-draw/engine";
import type { MermaidErrorCode } from "@deviva-draw/engine";
import { useEffect, useMemo, useState } from "react";
import { buttonStyle, dialogOverlayStyle, dialogStyle, disabledButtonStyle, inputStyle, labelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { MermaidPreview } from "./mermaid-preview";
import { useTranslation } from "../i18n/use-translation";
import type { TranslationKey } from "../i18n/catalog-en";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

const EXAMPLE = `flowchart TD
  A[Start] --> B{Ready?}
  B -->|yes| C[Ship it]
  B -->|no| D[Keep working]
  D --> B`;

const PARSE_DEBOUNCE_MS = 150;

/** Maps an engine error code to a localized message key. "empty" shows no banner (just disables Insert). */
const ERROR_KEY: Record<Exclude<MermaidErrorCode, "empty">, TranslationKey> = {
  unsupported: "mermaid.error.unsupported",
  invalid: "mermaid.error.invalid",
  error: "mermaid.error.generic",
};

export function MermaidDialog(props: { runtime: DevivaRuntime; cameraStore: CameraStore; getViewportSize(): { width: number; height: number }; onClose(): void }) {
  const { runtime, cameraStore, getViewportSize, onClose } = props;
  const { t } = useTranslation();
  const [source, setSource] = useState(EXAMPLE);
  const [debounced, setDebounced] = useState(EXAMPLE);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(source), PARSE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [source]);

  const result = useMemo(() => tryMermaidToElements(debounced), [debounced]);
  const canInsert = result.elements.length > 0;
  const errorKey = result.error && result.error !== "empty" ? ERROR_KEY[result.error] : null;

  const insert = () => {
    if (!canInsert) return;
    const elements = result.elements;
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
      <div style={{ ...dialogStyle, width: 660, maxWidth: "94vw" }} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={t("mermaid.title")} data-testid="mermaid-dialog">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong>{t("mermaid.title")}</strong>
          <button type="button" aria-label={t("shortcuts.close")} onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Icon name="close" />
          </button>
        </div>
        <span style={labelStyle}>{t("mermaid.description")}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6 }}>
          <textarea
            data-testid="mermaid-input"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            style={{ ...inputStyle, flex: "1 1 260px", minWidth: 260, height: 244, fontFamily: "monospace", fontSize: 12, resize: "vertical", boxSizing: "border-box" }}
          />
          <div style={{ flex: "1 1 260px", minWidth: 260 }}>
            <MermaidPreview elements={result.elements} />
          </div>
        </div>
        {errorKey && (
          <div data-testid="mermaid-error" role="alert" style={{ marginTop: 10, fontSize: 12, color: "var(--dd-danger, #c0392b)" }}>
            {t(errorKey)}
          </div>
        )}
        <button
          type="button"
          data-testid="mermaid-insert"
          disabled={!canInsert}
          style={{ ...buttonStyle(false), ...(canInsert ? {} : disabledButtonStyle), width: "100%", justifyContent: "center", marginTop: 10 }}
          onClick={insert}
        >
          {t("mermaid.insert")}
        </button>
      </div>
    </div>
  );
}
