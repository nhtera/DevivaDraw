/**
 * Personal element library panel (Excalidraw parity): save the current selection as a reusable item,
 * then click an item to drop a fresh copy at the viewport center. Items persist in localStorage
 * (`browser/library-storage.ts`) and can be exported/imported as a `.devivalib` JSON file. Re-inserting
 * goes through the engine's `insertElements` so every drop gets brand-new ids (no id collisions).
 */
import { computeElementsBounds, expandForDuplication, insertElements, screenToScene } from "@deviva-draw/engine";
import type { AnyElement } from "@deviva-draw/engine";
import { useEffect, useState } from "react";
import { buttonStyle, labelStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { renderElementsToThumbnail } from "../browser/scene-file-operations";
import { pickAndReadFile, saveFile } from "../browser/persistence-adapters";
import { addLibraryItem, loadLibrary, mergeImportedLibrary, removeLibraryItem } from "../browser/library-storage";
import type { LibraryItem } from "../browser/library-storage";
import { useSelectionVersion } from "../runtime/use-live-version";
import { useTranslation } from "../i18n/use-translation";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lib-${Date.now().toString(36)}`;
}

interface LibraryPanelProps {
  runtime: DevivaRuntime;
  cameraStore: CameraStore;
  getViewportSize(): { width: number; height: number };
  onClose(): void;
}

export function LibraryPanel(props: LibraryPanelProps) {
  const { runtime, cameraStore, getViewportSize, onClose } = props;
  const { t } = useTranslation();
  const [items, setItems] = useState<LibraryItem[]>(() => loadLibrary());
  useSelectionVersion(runtime.selection); // re-render so the "add" button enables/disables with the selection

  const selectionIds = [...runtime.selection.getSelectedIds()];
  const canAdd = selectionIds.length > 0;

  const addSelection = async () => {
    const ids = expandForDuplication(runtime.scene, selectionIds);
    const elements = ids
      .map((id) => runtime.scene.getElement(id))
      .filter((element): element is AnyElement => !!element && !element.isDeleted)
      .map((element) => structuredClone(element));
    if (elements.length === 0) return;
    const preview = await renderElementsToThumbnail(elements);
    setItems(addLibraryItem({ id: newId(), name: `Item ${items.length + 1}`, elements, preview, created: 0 }));
  };

  const insertItem = (item: LibraryItem) => {
    const bounds = computeElementsBounds(item.elements);
    if (!bounds) return;
    const { width, height } = getViewportSize();
    const center = screenToScene({ x: width / 2, y: height / 2 }, cameraStore.getCamera());
    const offset = { dx: center.x - (bounds.x + bounds.width / 2), dy: center.y - (bounds.y + bounds.height / 2) };
    runtime.history.beginBatch();
    const newIds = insertElements(runtime.scene, item.elements, offset);
    runtime.history.endBatch(runtime.scene.getElements());
    if (newIds.length > 0) runtime.selection.selectOnly(newIds);
  };

  const exportLibrary = () => {
    void saveFile("library.devivalib", JSON.stringify(items, null, 2), "application/json");
  };

  const importLibrary = async () => {
    const text = await pickAndReadFile(".devivalib");
    if (text === null) return;
    try {
      setItems(mergeImportedLibrary(JSON.parse(text)));
    } catch (error) {
      console.warn("deviva-draw: library import failed — not valid JSON", error);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      data-testid="library-panel"
      className="dd-animate-in"
      style={{ ...panelStyle, position: "absolute", top: 60, left: 12, width: 232, maxHeight: "calc(100% - 80px)", display: "flex", flexDirection: "column", padding: 10, zIndex: 40 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{t("library.title")}</strong>
        <button type="button" aria-label={t("shortcuts.close")} onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
          <Icon name="close" />
        </button>
      </div>

      <button type="button" data-testid="library-add" disabled={!canAdd} style={{ ...buttonStyle(false), justifyContent: "center", width: "100%", opacity: canAdd ? 1 : 0.5 }} onClick={() => void addSelection()}>
        {t("library.addSelection")}
      </button>

      {items.length === 0 ? (
        <p style={{ ...labelStyle, textAlign: "center", padding: "16px 4px" }}>{t("library.empty")}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, overflowY: "auto", marginTop: 8, paddingRight: 2 }}>
          {items.map((item) => (
            <div key={item.id} style={{ position: "relative" }}>
              <button
                type="button"
                data-testid="library-item"
                title={item.name}
                onClick={() => insertItem(item)}
                style={{ width: "100%", aspectRatio: "1", border: "1px solid var(--dd-chrome-border)", borderRadius: 6, background: "#fff", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
              >
                <img src={item.preview} alt={item.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
              </button>
              <button
                type="button"
                data-testid="library-item-remove"
                aria-label={t("library.remove")}
                title={t("library.remove")}
                onClick={() => setItems(removeLibraryItem(item.id))}
                style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", border: "1px solid var(--dd-chrome-border)", background: "var(--dd-chrome-background-elevated)", cursor: "pointer", fontSize: 11, lineHeight: "16px", padding: 0 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button type="button" data-testid="library-import" style={{ ...buttonStyle(false), flex: 1, justifyContent: "center", fontSize: 12 }} onClick={() => void importLibrary()}>
          {t("library.import")}
        </button>
        <button type="button" data-testid="library-export" disabled={items.length === 0} style={{ ...buttonStyle(false), flex: 1, justifyContent: "center", fontSize: 12, opacity: items.length === 0 ? 0.5 : 1 }} onClick={exportLibrary}>
          {t("library.export")}
        </button>
      </div>
    </div>
  );
}
