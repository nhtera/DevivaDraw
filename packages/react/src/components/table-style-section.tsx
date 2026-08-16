/**
 * Structure + text-style controls for selected tables: append/remove rows and columns (end-only in
 * v1; the last row/column is guarded) plus the table's own font size/family. Owns its controls
 * directly (the `TextStyleSection` shape) — the shared `textStyleTargets` predicate is deliberately
 * NOT widened to tables: it gates the floating text panel, whose textAlign assumptions don't apply
 * here. Every structural mutation builds NEW arrays via the DEFENSIVE grid readers (a
 * collab-ingested table's raw arrays must never leak into a write — the table-layout contract) and
 * re-derives the summed width/height; one history batch each. Font changes re-fit rows in the same
 * batch (a larger font would otherwise clip until the next edit).
 */
import {
  createCanvasTextMeasurer,
  DEFAULT_TABLE_COLUMN_WIDTH,
  DEFAULT_TABLE_ROW_HEIGHT,
  fitRowHeightsToText,
  FONT_SIZE_LEVELS,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  tableCellsGrid,
  tableColumnWidths,
  tableRowHeights,
} from "@deviva-draw/engine";
import type { AnyElement, TableElement, TextFontFamily } from "@deviva-draw/engine";
import { buttonStyle, labelStyle } from "./chrome-styles";
import { StyleSection } from "./style-section";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

const FONT_FAMILY_OPTIONS: TextFontFamily[] = ["normal", "code", "hand-drawn-slot"];

/** Shared measurer for row re-fits — one hidden 2d context, the established pattern (`use-deviva-runtime.ts`). */
const tableMeasurer = typeof document !== "undefined" ? createCanvasTextMeasurer(document.createElement("canvas").getContext("2d")!) : { measureTextWidth: () => 0 };

function selectedTables(runtime: DevivaRuntime): TableElement[] {
  return [...runtime.selection.getSelectedIds()]
    .map((id) => runtime.scene.getElement(id))
    .filter((element): element is TableElement => !!element && !element.isDeleted && element.type === "table");
}

export function TableStyleSection(props: { runtime: DevivaRuntime }) {
  const { runtime } = props;
  const { t } = useTranslation();
  const tables = selectedTables(runtime);
  if (tables.length === 0) return null;
  const first = tables[0]!;

  /** One batch across every selected table; cancelled when every table's guard refused. */
  const restructure = (mutate: (table: TableElement) => Partial<TableElement> | null) => {
    runtime.history.beginBatch();
    let touched = false;
    for (const table of tables) {
      const changes = mutate(table);
      if (!changes) continue;
      runtime.scene.updateElement(table.id, changes as Partial<AnyElement>);
      touched = true;
    }
    if (touched) runtime.history.endBatch(runtime.scene.getElements());
    else runtime.history.cancelBatch();
  };

  const addRow = () =>
    restructure((table) => {
      const rowHeights = tableRowHeights(table);
      if (rowHeights.length >= MAX_TABLE_ROWS) return null;
      const grown = [...rowHeights, DEFAULT_TABLE_ROW_HEIGHT];
      const cells = [...tableCellsGrid(table), Array.from({ length: tableColumnWidths(table).length }, () => "")];
      return { rowHeights: grown, cells, height: grown.reduce((a, b) => a + b, 0) };
    });
  const removeRow = () =>
    restructure((table) => {
      const rowHeights = tableRowHeights(table);
      if (rowHeights.length <= 1) return null;
      const shrunk = rowHeights.slice(0, -1);
      return { rowHeights: shrunk, cells: tableCellsGrid(table).slice(0, -1), height: shrunk.reduce((a, b) => a + b, 0) };
    });
  const addColumn = () =>
    restructure((table) => {
      const columnWidths = tableColumnWidths(table);
      if (columnWidths.length >= MAX_TABLE_COLS) return null;
      const grown = [...columnWidths, DEFAULT_TABLE_COLUMN_WIDTH];
      return { columnWidths: grown, cells: tableCellsGrid(table).map((rowCells) => [...rowCells, ""]), width: grown.reduce((a, b) => a + b, 0) };
    });
  const removeColumn = () =>
    restructure((table) => {
      const columnWidths = tableColumnWidths(table);
      if (columnWidths.length <= 1) return null;
      const shrunk = columnWidths.slice(0, -1);
      return { columnWidths: shrunk, cells: tableCellsGrid(table).map((rowCells) => rowCells.slice(0, -1)), width: shrunk.reduce((a, b) => a + b, 0) };
    });

  // A font change re-wraps every cell, so rows re-fit in the same batch (the commit-path rule).
  const restyleWithRefit = (changes: Partial<TableElement>) => {
    runtime.history.beginBatch();
    for (const table of tables) {
      runtime.scene.updateElement(table.id, changes as Partial<AnyElement>);
      const updated = runtime.scene.getElement(table.id);
      if (updated && updated.type === "table") {
        const fit = fitRowHeightsToText(updated, tableMeasurer);
        if (fit) runtime.scene.updateElement(table.id, fit as Partial<TableElement>);
      }
    }
    runtime.history.endBatch(runtime.scene.getElements());
  };

  // Disabled only when NO selected table can accept the operation — with mixed sizes, the click
  // applies to the tables that can and no-ops for the rest (the per-table guard in restructure).
  const canAddRow = tables.some((table) => tableRowHeights(table).length < MAX_TABLE_ROWS);
  const canRemoveRow = tables.some((table) => tableRowHeights(table).length > 1);
  const canAddColumn = tables.some((table) => tableColumnWidths(table).length < MAX_TABLE_COLS);
  const canRemoveColumn = tables.some((table) => tableColumnWidths(table).length > 1);

  const structureButton = (testId: string, label: string, onClick: () => void, enabled: boolean) => (
    <button type="button" data-testid={testId} title={label} aria-label={label} onClick={onClick} disabled={!enabled} style={{ ...buttonStyle, flex: 1, opacity: enabled ? 1 : 0.4 }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div>
        <span style={labelStyle}>{t("table.rows")}</span>
        <div style={{ display: "flex", gap: 2 }}>
          {structureButton("table-add-row", t("table.addRow"), addRow, canAddRow)}
          {structureButton("table-remove-row", t("table.removeRow"), removeRow, canRemoveRow)}
        </div>
      </div>
      <div>
        <span style={labelStyle}>{t("table.columns")}</span>
        <div style={{ display: "flex", gap: 2 }}>
          {structureButton("table-add-column", t("table.addColumn"), addColumn, canAddColumn)}
          {structureButton("table-remove-column", t("table.removeColumn"), removeColumn, canRemoveColumn)}
        </div>
      </div>
      <StyleSection
        label={t("panel.fontFamily")}
        value={first.fontFamily}
        options={FONT_FAMILY_OPTIONS.map((value) => ({ value, label: t(`fontFamily.${value}`) }))}
        onChange={(value) => restyleWithRefit({ fontFamily: value } as Partial<TableElement>)}
      />
      <StyleSection
        label={t("panel.fontSize")}
        value={String(first.fontSize)}
        options={Object.entries(FONT_SIZE_LEVELS).map(([label, value]) => ({ value: String(value), label }))}
        onChange={(value) => restyleWithRefit({ fontSize: Number(value) } as Partial<TableElement>)}
      />
    </div>
  );
}
