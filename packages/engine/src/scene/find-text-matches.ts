/**
 * "Find on canvas" (Excalidraw's Cmd+F): returns the ids of every text-bearing element whose text
 * contains the query, in scene draw order, so the chrome layer can step through matches and reveal
 * each one. Covers standalone text and shape/note labels alike — both are `text` elements (a label is
 * just a `text` with a `containerId`), so one pass over text elements finds every match. Deleted
 * elements are skipped. Case-insensitive; an empty/whitespace query matches nothing (returns `[]`).
 */
import type { Scene } from "./scene";

export function findTextMatches(scene: Scene, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const matches: string[] = [];
  for (const element of scene.getElements()) {
    if (element.isDeleted || element.type !== "text") continue;
    if (element.text.toLowerCase().includes(needle)) matches.push(element.id);
  }
  return matches;
}
