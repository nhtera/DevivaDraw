/**
 * Export dialog (Excalidraw parity): pick a scale + whether to include the background, then export the
 * scene as PNG, SVG, or PDF — or copy it to the clipboard. The quick "Export as PNG/SVG" menu items
 * still exist for a one-click default; this dialog is the "I want options" path. All the actual
 * rendering lives in `browser/scene-file-operations.ts`; this is just the control surface.
 */
import { useState } from "react";
import { frameContainedElementIds } from "@deviva-draw/engine";
import { orderedSceneFrames } from "./presentation/frame-slide-order";
import { buttonStyle, dialogOverlayStyle, dialogStyle, labelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import {
  copySceneImageToClipboard,
  exportScenePdfFile,
  exportSceneToPngFile,
  exportSceneToSvgFile,
} from "../browser/scene-file-operations";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

const SCALES = [1, 2, 3] as const;
type Scale = (typeof SCALES)[number];

export function ExportDialog(props: { runtime: DevivaRuntime; onClose(): void }) {
  const { runtime, onClose } = props;
  const { t } = useTranslation();
  const [scale, setScale] = useState<Scale>(2);
  const [includeBackground, setIncludeBackground] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);
  const [onlyFrame, setOnlyFrame] = useState(false);
  const [busy, setBusy] = useState(false);

  const scene = runtime.scene;
  const selectedCount = runtime.selection.size;
  // "Current frame" means the selected frame, or the deck's FIRST SLIDE when nothing is selected.
  // `orderedSceneFrames` is shared with the presentation walk precisely so the two agree: raw scene
  // order would export a different frame than Present opens on, for any deck using numeric name
  // prefixes. A frame's own element is included alongside its contents so the exported image keeps
  // the frame border the user sees on canvas.
  const frames = orderedSceneFrames(scene.getElements());
  const currentFrame = frames.find((frame) => runtime.selection.isSelected(frame.id)) ?? frames[0] ?? null;
  const frameElements = currentFrame
    ? [currentFrame, ...frameContainedElementIds(scene, currentFrame.id).map((id) => scene.getElement(id)).filter((element): element is NonNullable<typeof element> => Boolean(element && !element.isDeleted))]
    : [];
  // Dark export pairs the color adapter with the dark canvas background; the transparent option still wins when the background box is unticked.
  const background = includeBackground ? (darkMode ? "#1e1e1e" : scene.getBackground() ?? "#ffffff") : null;
  // Scope precedence: frame beats selection. Both are explicit opt-ins, and a frame is the narrower,
  // more deliberate of the two — nothing else would explain ticking it while a selection exists.
  const scopedElements = () => {
    if (onlyFrame && frameElements.length > 0) return frameElements;
    if (onlySelected && selectedCount > 0) return scene.getElements().filter((element) => !element.isDeleted && runtime.selection.isSelected(element.id));
    return undefined;
  };
  const extras = { darkMode, elements: scopedElements() };

  // Every export goes through here, which is also the one place image data can be waited for: these
  // buttons render the scene directly rather than through the file actions, so without this a dialog
  // opened before the board's images have been read back would export blank boxes. See
  // `PersistenceOperations.whenFilesReady`.
  const run = (task: () => Promise<void>) => {
    setBusy(true);
    runtime.persistence
      .whenFilesReady()
      .then(task)
      .catch((error) => console.error("deviva-draw: export failed", error))
      .finally(() => setBusy(false));
  };

  return (
    <div style={dialogOverlayStyle} onClick={onClose} data-testid="export-dialog-overlay">
      <div style={dialogStyle} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={t("export.title")} data-testid="export-dialog">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <strong>{t("export.title")}</strong>
          <button type="button" aria-label={t("shortcuts.close")} onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Icon name="close" />
          </button>
        </div>

        <span style={labelStyle}>{t("export.scale")}</span>
        <div style={{ display: "flex", gap: 6, margin: "4px 0 12px" }} role="radiogroup" aria-label={t("export.scale")}>
          {SCALES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scale === value}
              data-testid={`export-scale-${value}`}
              style={{ ...buttonStyle(scale === value), flex: 1, justifyContent: "center" }}
              onClick={() => setScale(value)}
            >
              {value}×
            </button>
          ))}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" data-testid="export-include-background" checked={includeBackground} onChange={(event) => setIncludeBackground(event.target.checked)} />
          <span>{t("export.background")}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" data-testid="export-dark-mode" checked={darkMode} onChange={(event) => setDarkMode(event.target.checked)} />
          <span>{t("export.darkMode")}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: selectedCount > 0 ? "pointer" : "default", opacity: selectedCount > 0 ? 1 : 0.5 }}>
          <input type="checkbox" data-testid="export-only-selected" disabled={selectedCount === 0} checked={onlySelected && selectedCount > 0} onChange={(event) => setOnlySelected(event.target.checked)} />
          <span>{t("export.onlySelected")}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" data-testid="export-only-frame" disabled={frames.length === 0} checked={onlyFrame && frameElements.length > 0} onChange={(event) => setOnlyFrame(event.target.checked)} />
          <span>{t("export.currentFrame")}</span>
        </label>

        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" disabled={busy} data-testid="export-png" style={{ ...buttonStyle(false), flex: 1, justifyContent: "center" }} onClick={() => run(() => exportSceneToPngFile(scene, scale, background, extras))}>
            PNG
          </button>
          <button type="button" disabled={busy} data-testid="export-svg" style={{ ...buttonStyle(false), flex: 1, justifyContent: "center" }} onClick={() => run(() => exportSceneToSvgFile(scene, background, extras))}>
            SVG
          </button>
          <button type="button" disabled={busy} data-testid="export-pdf" style={{ ...buttonStyle(false), flex: 1, justifyContent: "center" }} onClick={() => run(() => exportScenePdfFile(scene, scale, background ?? (darkMode ? "#1e1e1e" : "#ffffff"), extras))}>
            PDF
          </button>
        </div>
        <button type="button" disabled={busy} data-testid="export-copy" style={{ ...buttonStyle(false), width: "100%", justifyContent: "center", marginTop: 6 }} onClick={() => run(() => copySceneImageToClipboard(scene, background))}>
          <Icon name="copy-image" />
          {t("action.copyAsImage")}
        </button>
      </div>
    </div>
  );
}
