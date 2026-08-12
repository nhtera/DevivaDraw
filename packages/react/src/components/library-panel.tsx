/**
 * Personal element library, laid out as a full-height edge sidebar following Excalidraw's library
 * pattern: search at the top, a titled section over a dense four-column tile grid, and the file
 * actions pinned to the bottom. The old form — a small floating box with a button above a two-column
 * list — did not survive contact with real libraries, which run to dozens of items.
 *
 * Sits on the *right* edge like Excalidraw's, so it owns that edge outright — but it is full-height,
 * and the minimap and its own toggle button are anchored there too. While it is open it publishes its
 * width as `--dd-library-sidebar-width` on the app root and both of those shift left by it, rather
 * than being covered.
 *
 * Items are placed by clicking a tile (viewport centre) or by dragging one onto the canvas (at the
 * cursor) — see `hooks/use-library-drop.ts`.
 *
 * Items persist in localStorage (`browser/library-storage.ts`); import reads this app's `.devivalib`
 * and Excalidraw's `.excalidrawlib` (`browser/library-import.ts`). Re-inserting goes through the
 * engine's `insertElements`, so every drop gets brand-new ids and brand-new group ids.
 */
import { screenToScene } from "@deviva-draw/engine";
import { useEffect, useMemo, useState } from "react";
import { buttonStyle, chromeFontFamily, PANEL_SHADOW } from "./chrome-styles";
import { Icon } from "./icon";
import { GRID_COLUMNS, GRID_GAP, LibraryGrid, TILE_SIZE } from "./library-grid";
import { renderElementsToThumbnail } from "../browser/scene-file-operations";
import { pickAndReadFile, saveFile } from "../browser/persistence-adapters";
import { libraryItemMatches } from "../browser/library-item-name";
import { onLibraryChanged } from "../browser/library-change-event";
import { librarySourceOf, loadLibrary, mergeImportedLibrary, removeLibraryItem } from "../browser/library-storage";
import { saveSelectionToLibrary } from "../browser/save-selection-to-library";
import type { LibraryItem } from "../browser/library-storage";
import { parseLibraryFile } from "../browser/library-import";
import { insertLibraryElementsAt } from "../browser/insert-library-item";
import type { Translator } from "../i18n/translate";
import { useSelectionVersion } from "../runtime/use-live-version";
import { useTranslation } from "../i18n/use-translation";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

const PADDING_X = 12;
const BORDER_WIDTH = 1;

/**
 * The tile grid plus its gutters, padding *and* left border — which lands within a pixel of
 * excalidraw.com's own 294px sidebar. The border has to be in the sum: the panel is `border-box`, so
 * leaving it out shrinks the content box by exactly the pixel that costs the grid its fourth column.
 */
const SIDEBAR_WIDTH = GRID_COLUMNS * TILE_SIZE + (GRID_COLUMNS - 1) * GRID_GAP + PADDING_X * 2 + BORDER_WIDTH;

/** Where the right-anchored chrome (the minimap, this panel's own toggle) reads its inset from — see the module doc. */
const SIDEBAR_WIDTH_PROPERTY = "--dd-library-sidebar-width";

/** This app's own format plus Excalidraw's — the picker offers both, and the parser detects which by content. */
const IMPORTABLE_LIBRARY_EXTENSIONS = ".devivalib,.excalidrawlib";

/**
 * The trailing " N unsupported (image) skipped." clause, or `""` when nothing was dropped. Naming the
 * types matters more than the count: it tells the user which parts of the Excalidraw library they are
 * missing, rather than leaving them to spot the gap on the canvas.
 */
function skippedSuffix(skipped: Record<string, number>, t: Translator): string {
  const types = Object.keys(skipped);
  if (types.length === 0) return "";
  const count = types.reduce((total, type) => total + skipped[type]!, 0);
  return ` ${t("library.importSkipped", { count, types: types.join(", ") })}`;
}

const sectionHeadingStyle = { margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "var(--dd-accent)" } as const;

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
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useSelectionVersion(runtime.selection); // re-render so the add tile enables/disables with the selection

  const selectionIds = [...runtime.selection.getSelectedIds()];
  const canAdd = selectionIds.length > 0;

  // Search filters *within* the shelves rather than collapsing them, so a hit keeps the context of
  // where it came from — the point of the split is knowing which collection a shape belongs to.
  // Matching covers the labels inside an item, not just its name: an imported set often supplies no
  // names at all, and a name-only search would find nothing in it (see `library-item-name.ts`).
  const [visiblePersonal, visibleImported] = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle === "" ? items : items.filter((item) => libraryItemMatches(item, needle));
    return [matches.filter((item) => librarySourceOf(item) === "personal"), matches.filter((item) => librarySourceOf(item) === "imported")];
  }, [items, query]);
  const visibleCount = visiblePersonal.length + visibleImported.length;

  // Shared with the context menu's "Add to library" (`browser/save-selection-to-library.ts`), which is
  // why the result is applied here rather than composed inline: one save path, two entry points.
  const addSelection = async () => {
    const saved = await saveSelectionToLibrary(runtime.scene, selectionIds);
    if (saved) setItems(saved);
  };

  // Clicking places at the viewport centre; dragging the same tile onto the canvas places at the
  // cursor instead (`hooks/use-library-drop.ts`). Both go through one insert helper.
  const insertItem = (item: LibraryItem) => {
    const { width, height } = getViewportSize();
    insertLibraryElementsAt(runtime, item.elements, screenToScene({ x: width / 2, y: height / 2 }, cameraStore.getCamera()));
  };

  const removeItem = (id: string) => setItems(removeLibraryItem(id));

  const exportLibrary = () => {
    void saveFile("library.devivalib", JSON.stringify(items, null, 2), "application/json");
  };

  const importLibrary = async () => {
    const text = await pickAndReadFile(IMPORTABLE_LIBRARY_EXTENSIONS);
    if (text === null) return;

    setStatus(null);
    const result = await parseLibraryFile(text, renderElementsToThumbnail);
    if ("error" in result) {
      setStatus(t(result.error === "invalid-json" ? "library.importNotJson" : "library.importUnrecognized"));
      return;
    }

    setItems(mergeImportedLibrary(result.items));
    setStatus(t("library.imported", { count: result.items.length }) + skippedSuffix(result.skipped, t));
  };

  // The shelf is read into state once, on mount, so a write from outside this panel — a library file
  // dropped on the canvas, "Add to library" from the context menu — would otherwise not show up until
  // it was closed and reopened.
  useEffect(() => onLibraryChanged(() => setItems(loadLibrary())), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Reserve the sidebar's width for the right-anchored chrome (the minimap, the toggle) while it is
  // open — see the module doc. Cleared on unmount so closing the panel hands the space straight back.
  // The nominal width is right even when the panel is capped narrower on a phone: both consumers of
  // this variable are desktop-only, and neither renders at the widths where the cap bites.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="deviva-draw-root"]');
    if (!root) return;
    root.style.setProperty(SIDEBAR_WIDTH_PROPERTY, `${SIDEBAR_WIDTH}px`);
    return () => {
      root.style.removeProperty(SIDEBAR_WIDTH_PROPERTY);
    };
  }, []);

  return (
    <aside
      data-testid="library-panel"
      aria-label={t("library.title")}
      className="dd-slide-in-right"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        // Capped by the viewport so a phone gets a full-width sheet rather than a sidebar hanging off
        // the edge; the grid drops a column to match (see `library-grid.tsx`).
        width: `min(${SIDEBAR_WIDTH}px, 100%)`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: "var(--dd-chrome-background-elevated)",
        color: "var(--dd-text-primary)",
        borderLeft: `${BORDER_WIDTH}px solid var(--dd-chrome-border)`,
        boxShadow: PANEL_SHADOW,
        fontFamily: chromeFontFamily,
        fontSize: 13,
        zIndex: 40,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: `10px ${PADDING_X}px`, borderBottom: "1px solid var(--dd-chrome-border)" }}>
        <input
          data-testid="library-search"
          type="text"
          value={query}
          placeholder={t("library.search")}
          aria-label={t("library.search")}
          onChange={(event) => setQuery(event.target.value)}
          style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--dd-chrome-border)", background: "var(--dd-chrome-background)", color: "var(--dd-text-primary)", fontSize: 14, fontFamily: "inherit" }}
        />
        <button type="button" data-testid="library-close" aria-label={t("shortcuts.close")} title={t("shortcuts.close")} onClick={onClose} style={{ ...buttonStyle(false), padding: 6 }}>
          <Icon name="close" />
        </button>
      </header>

      <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: `16px ${PADDING_X}px` }}>
        <h2 style={sectionHeadingStyle}>{t("library.personal")}</h2>
        <LibraryGrid items={visiblePersonal} showAddTile canAdd={canAdd} onAdd={() => void addSelection()} onInsert={insertItem} onRemove={removeItem} />

        {/* Hidden until something has actually been imported, so a fresh library is one shelf, not an
            empty heading. */}
        {visibleImported.length > 0 && (
          <>
            <h2 data-testid="library-imported-heading" style={{ ...sectionHeadingStyle, marginTop: 20 }}>
              {t("library.importedLibrary")}
            </h2>
            <LibraryGrid items={visibleImported} showAddTile={false} canAdd={false} onAdd={() => undefined} onInsert={insertItem} onRemove={removeItem} />
          </>
        )}

        {items.length > 0 && visibleCount === 0 && (
          <p data-testid="library-no-results" style={{ margin: "12px 0 0", fontSize: 12, color: "var(--dd-text-secondary)" }}>
            {t("library.noResults")}
          </p>
        )}
        {items.length === 0 && <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--dd-text-secondary)", lineHeight: 1.5 }}>{t("library.empty")}</p>}
      </div>

      <footer style={{ padding: `10px ${PADDING_X}px`, borderTop: "1px solid var(--dd-chrome-border)", display: "flex", flexDirection: "column", gap: 8 }}>
        {status !== null && (
          <p data-testid="library-status" role="status" style={{ margin: 0, fontSize: 11, color: "var(--dd-text-secondary)", lineHeight: 1.4 }}>
            {status}
          </p>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" data-testid="library-import" style={{ ...buttonStyle(false), flex: 1, border: "1px solid var(--dd-chrome-border)", fontSize: 12 }} onClick={() => void importLibrary()}>
            {t("library.import")}
          </button>
          <button
            type="button"
            data-testid="library-export"
            disabled={items.length === 0}
            style={{ ...buttonStyle(false), flex: 1, border: "1px solid var(--dd-chrome-border)", fontSize: 12, opacity: items.length === 0 ? 0.5 : 1 }}
            onClick={exportLibrary}
          >
            {t("library.export")}
          </button>
        </div>
      </footer>
    </aside>
  );
}
