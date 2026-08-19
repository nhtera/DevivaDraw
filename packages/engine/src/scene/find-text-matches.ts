/**
 * "Find on canvas" (Cmd+F): returns the ids of every text-bearing element whose text contains the
 * query, in scene draw order, so the chrome layer can step through matches and reveal each one.
 * Covers standalone text and shape/note labels alike — both are `text` elements (a label is just a
 * `text` with a `containerId`), so one pass over text elements finds every match. Table cells and
 * frame names carry their own text on the owning element and get their own branch below. Deleted
 * elements are skipped. Case-insensitive; an empty/whitespace query matches nothing (returns `[]`).
 *
 * Scene-scoped by design: one scene in, ids out. Searching a whole multi-page document is the
 * caller's walk over the page store (`packages/react`'s `browser/find-across-pages.ts`) calling this
 * per page, which keeps the engine free of any page-list dependency.
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
    // A frame's name is how a user labels a region, so it is the obvious thing to search for once a
    // document has many of them — "find the slide called Pricing" is the same intent as finding its
    // text. The name lives on the frame element itself, not in a child `text`.
    //
    // Read defensively for the same reason the table branch above is: a collab peer's element is
    // admitted on its base fields alone (`collab-client`'s `isPlausibleRemoteElement` checks no
    // type-specific field), so `name` is only a `string` by local convention, not by the time it
    // reaches here. Find recomputes on every scene mutation while its panel is open, so an
    // ingested frame with no name would throw on the next remote edit rather than on a keystroke.
    else if (element.type === "frame" && typeof element.name === "string" && element.name.toLowerCase().includes(needle)) matches.push(element.id);
  }
  return matches;
}
