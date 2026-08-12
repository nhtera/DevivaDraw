/**
 * The library sidebar's tile grid, following Excalidraw's library pattern: a dense square grid of
 * preview tiles with a leading "add the current selection" tile, rather than a separate button above
 * a list. Measurements are taken from excalidraw.com's own sidebar (55px tiles, 16px gutters, four
 * columns) so a library authored there reads at the same density here.
 *
 * The remove affordance appears on hover/focus only (`chrome-stylesheet.ts`'s `.dd-library-tile`
 * rules): at four columns an always-visible × on every tile turns the grid into a field of buttons,
 * and hiding it behind hover is what keeps the previews readable. Focus-within keeps it reachable
 * without a pointer.
 *
 * Each tile is also a drag source (`browser/library-drag.ts`): clicking drops the item at the viewport
 * centre, dragging drops it wherever the cursor lands.
 */
import { RADIUS } from "./chrome-styles";
import { beginLibraryDrag, endLibraryDrag } from "../browser/library-drag";
import { useTranslation } from "../i18n/use-translation";
import type { LibraryItem } from "../browser/library-storage";

export const TILE_SIZE = 55;
export const GRID_COLUMNS = 4;
export const GRID_GAP = 16;

/**
 * `auto-fill` rather than a hard `repeat(GRID_COLUMNS, …)`: at the sidebar's own width this resolves
 * to exactly `GRID_COLUMNS` tiles, but on a phone — where the sidebar shrinks to the screen — it drops
 * to three or two instead of overflowing its container sideways. Tiles keep their fixed size either
 * way, so previews never stretch.
 */
const gridStyle = {
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, ${TILE_SIZE}px)`,
  gap: GRID_GAP,
  justifyContent: "start",
} as const;

interface LibraryGridProps {
  items: readonly LibraryItem[];
  /** Renders the leading "add the current selection" tile — only the personal shelf accepts new items. */
  showAddTile: boolean;
  canAdd: boolean;
  onAdd(): void;
  onInsert(item: LibraryItem): void;
  onRemove(id: string): void;
}

export function LibraryGrid(props: LibraryGridProps) {
  const { items, showAddTile, canAdd, onAdd, onInsert, onRemove } = props;
  const { t } = useTranslation();

  return (
    <div style={gridStyle}>
      {showAddTile && (
      <button
        type="button"
        data-testid="library-add"
        disabled={!canAdd}
        title={t("library.addSelection")}
        aria-label={t("library.addSelection")}
        onClick={onAdd}
        style={{
          width: TILE_SIZE,
          height: TILE_SIZE,
          borderRadius: RADIUS.control,
          // Dashed rather than solid: the tile is an empty slot to fill, not an item that exists yet.
          border: "1px dashed var(--dd-accent)",
          background: "var(--dd-accent-soft)",
          color: "var(--dd-accent)",
          fontSize: 22,
          lineHeight: 1,
          cursor: canAdd ? "pointer" : "default",
          opacity: canAdd ? 1 : 0.4,
          padding: 0,
        }}
      >
        +
      </button>
      )}

      {items.map((item) => (
        <div
          key={item.id}
          className="dd-library-tile"
          // Draggable on the wrapper, not the inner button: the button keeps its plain click (drop at
          // the viewport centre) while the tile as a whole can be dragged to a chosen spot, and the
          // browser gets the whole tile — preview included — as the drag image for free.
          draggable
          onDragStart={(event) => beginLibraryDrag(event, item)}
          onDragEnd={endLibraryDrag}
          style={{ position: "relative", width: TILE_SIZE, height: TILE_SIZE }}
        >
          <button
            type="button"
            data-testid="library-item"
            title={item.name}
            aria-label={item.name}
            onClick={() => onInsert(item)}
            style={{
              width: "100%",
              height: "100%",
              borderRadius: RADIUS.control,
              // A transparent border, not none: the hover state swaps its color in without the tile
              // resizing by a pixel and nudging the whole grid.
              border: "1px solid transparent",
              background: "transparent",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <img src={item.preview} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </button>
          <button
            type="button"
            className="dd-library-tile__remove"
            data-testid="library-item-remove"
            aria-label={`${t("library.remove")}: ${item.name}`}
            title={t("library.remove")}
            onClick={() => onRemove(item.id)}
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: "1px solid var(--dd-chrome-border)",
              background: "var(--dd-chrome-background-elevated)",
              color: "var(--dd-text-primary)",
              cursor: "pointer",
              fontSize: 11,
              lineHeight: "16px",
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
