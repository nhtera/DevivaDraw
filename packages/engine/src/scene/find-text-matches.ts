/**
 * "Find on canvas" (Excalidraw's Cmd+F): returns the ids of every text-bearing element whose text
 * contains the query, in scene draw order, so the chrome layer can step through matches and reveal
 * each one. Covers standalone text and shape/note labels alike — both are `text` elements (a label is
 * just a `text` with a `containerId`), so one pass over text elements finds every match. Deleted
 * elements are skipped. Case-insensitive; an empty/whitespace query matches nothing (returns `[]`).
 */
import type { Scene } from "./scene";

/** A table cell's text lives on the table element itself (`cells[row][col]`, see `elements/table-element.ts`), so tables need their own scan beside the text-element pass. Reads defensively (a collab-ingested grid may be malformed — never index it raw). */
function tableCellsContain(cells: unknown, needle: string): boolean {
  if (!Array.isArray(cells)) return false;
  return cells.some((rowCells) => Array.isArray(rowCells) && rowCells.some((cell) => typeof cell === "string" && cell.toLowerCase().includes(needle)));
}

export function findTextMatches(scene: Scene, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const matches: string[] = [];
  for (const element of scene.getElements()) {
    if (element.isDeleted || scene.isElementHidden(element)) continue;
    if (element.type === "text" && element.text.toLowerCase().includes(needle)) matches.push(element.id);
    else if (element.type === "table" && tableCellsContain(element.cells, needle)) matches.push(element.id);
  }
  return matches;
}
