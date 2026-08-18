/**
 * "Mermaid to diagram" dialog (Excalidraw parity, no LLM): paste Mermaid text and insert it as editable
 * Deviva shapes. Parsing/layout lives in the engine (`tryMermaidToElements`); this is the control
 * surface. A debounced live preview (`MermaidPreview`) shows the parsed result as you type, and an
 * inline error appears for unparseable input.
 *
 * Diagram types Deviva can't natively convert (pie, gantt, …) take the image fallback: the real
 * `mermaid` lib (lazily loaded — see `mermaid-image-fallback.ts`) rasterizes them to a PNG that's shown
 * in the preview and inserted as an image element. Native inserts go through `insertElements`; image
 * inserts through `insertImageFile` — both offset to the viewport center, in one history batch, and
 * selected so they can be moved/tweaked immediately.
 */
import { computeElementsBounds, insertElements, insertImageFile, screenToScene, tryMermaidToElements } from "@deviva-draw/engine";
import type { MermaidErrorCode } from "@deviva-draw/engine";
import { useEffect, useMemo, useState } from "react";
import { buttonStyle, dialogOverlayStyle, dialogStyle, disabledButtonStyle, inputStyle, labelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { MermaidAiSection } from "./mermaid-ai-section";
import { MermaidPreview } from "./mermaid-preview";
import { decodeNaturalSize } from "../browser/browser-image-decode";
import { renderUnsupportedToImage } from "../runtime/mermaid-image-fallback";
import type { MermaidImage } from "../runtime/mermaid-image-fallback";
import { useEscapeToClose } from "../hooks/use-escape-to-close";
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

type ImageState = { status: "idle" | "loading" | "ready" | "error"; image?: MermaidImage };

export function MermaidDialog(props: { runtime: DevivaRuntime; cameraStore: CameraStore; getViewportSize(): { width: number; height: number }; onClose(): void }) {
  const { runtime, cameraStore, getViewportSize, onClose } = props;
  const { t } = useTranslation();
  useEscapeToClose(onClose);
  const [source, setSource] = useState(EXAMPLE);
  const [debounced, setDebounced] = useState(EXAMPLE);
  const [imageState, setImageState] = useState<ImageState>({ status: "idle" });
  const [inserting, setInserting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(source), PARSE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [source]);

  const result = useMemo(() => tryMermaidToElements(debounced), [debounced]);
  const isImage = result.type === "unsupported";

  // Unsupported types are rasterized via the lazily-loaded mermaid lib; re-render on each debounced edit.
  useEffect(() => {
    if (!isImage) {
      setImageState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setImageState({ status: "loading" });
    renderUnsupportedToImage(debounced)
      .then((image) => !cancelled && setImageState({ status: "ready", image }))
      .catch(() => !cancelled && setImageState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [isImage, debounced]);

  const canInsert = !inserting && (isImage ? imageState.status === "ready" : result.elements.length > 0);
  const errorKey = isImage
    ? imageState.status === "error"
      ? "mermaid.error.generic"
      : null
    : result.error && result.error !== "empty"
      ? ERROR_KEY[result.error]
      : null;

  const insertNative = () => {
    const bounds = computeElementsBounds(result.elements);
    if (!bounds) return;
    const { width, height } = getViewportSize();
    const center = screenToScene({ x: width / 2, y: height / 2 }, cameraStore.getCamera());
    const offset = { dx: center.x - (bounds.x + bounds.width / 2), dy: center.y - (bounds.y + bounds.height / 2) };
    runtime.history.beginBatch();
    const newIds = insertElements(runtime.scene, result.elements, offset);
    runtime.history.endBatch(runtime.scene.getElements());
    if (newIds.length > 0) runtime.selection.selectOnly(newIds);
  };

  /** Returns true on success. On failure it rolls back the open history batch and flags the error. */
  const insertImage = async (): Promise<boolean> => {
    if (imageState.status !== "ready" || !imageState.image) return false;
    const { width, height } = getViewportSize();
    const position = screenToScene({ x: width / 2, y: height / 2 }, cameraStore.getCamera());
    runtime.history.beginBatch();
    try {
      const { element } = await insertImageFile({ scene: runtime.scene, bytes: imageState.image.bytes, mimeType: "image/png", decodeNaturalSize, position, maxFitSize: { width, height } });
      runtime.history.endBatch(runtime.scene.getElements());
      runtime.selection.selectOnly([element.id]);
      return true;
    } catch {
      // Never leave the batch open — an abandoned beginBatch() silently disables undo/redo app-wide.
      runtime.history.cancelBatch();
      setImageState({ status: "error" });
      return false;
    }
  };

  const insert = () => {
    if (!canInsert) return;
    setInserting(true);
    void (async () => {
      try {
        if (isImage) {
          if (await insertImage()) onClose();
        } else {
          insertNative();
          onClose();
        }
      } finally {
        setInserting(false);
      }
    })();
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
        {/* Generated Mermaid lands in the source editor below, so the preview/insert flow (and the
            unsupported-type image fallback) work identically for typed and generated diagrams. */}
        <MermaidAiSection
          onGenerated={(generated) => {
            setSource(generated);
            setDebounced(generated);
          }}
        />
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
            {isImage ? <ImagePreview state={imageState} rendering={t("mermaid.rendering")} /> : <MermaidPreview elements={result.elements} />}
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

/** Preview pane for the image-fallback path: a loading note, then the rasterized PNG. */
function ImagePreview({ state, rendering }: { state: ImageState; rendering: string }) {
  const boxStyle = { display: "flex", alignItems: "center", justifyContent: "center", minHeight: 180, maxHeight: 260, overflow: "auto", background: "#ffffff", border: "1px solid var(--dd-chrome-border)", borderRadius: 8, padding: 8, boxSizing: "border-box" as const };
  if (state.status === "ready" && state.image) {
    return (
      <div data-testid="mermaid-preview" style={boxStyle}>
        <img src={state.image.dataUrl} alt="" style={{ maxWidth: "100%", maxHeight: 244, height: "auto" }} />
      </div>
    );
  }
  return <div data-testid="mermaid-preview" style={{ ...boxStyle, color: "var(--dd-text-secondary)", fontSize: 13 }}>{state.status === "loading" ? rendering : ""}</div>;
}
