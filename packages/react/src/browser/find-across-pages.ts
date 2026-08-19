/**
 * Document-wide find: runs the engine's scene-scoped `findTextMatches` over every page in the store
 * and tags each hit with the page it came from.
 *
 * Multi-page documents shipped in 0.10 while find stayed scene-scoped, so Cmd+F searched whichever
 * page happened to be on screen and answered "no matches" for text one page away. The walk lives
 * here rather than in the engine deliberately: the engine has no page-list concept and should not
 * grow one — a page store is a chrome-layer idea, and keeping the engine function as "one scene in,
 * ids out" is what lets the headless and collab paths reuse it unchanged.
 *
 * Order is page order, then scene draw order within each page, so stepping through matches walks the
 * document the way the page rail reads top to bottom.
 */
import { findTextMatches } from "@deviva-draw/engine";
import type { PageStore } from "../pages/page-store";

/** One match, carrying enough page identity for the panel to label it and to switch pages before revealing. */
export interface PageMatch {
  pageId: string;
  pageName: string;
  elementId: string;
}

export function findMatchesAcrossPages(store: PageStore, query: string): PageMatch[] {
  const matches: PageMatch[] = [];
  for (const page of store.getPages()) {
    const scene = store.getSceneById(page.id);
    if (!scene) continue;
    for (const elementId of findTextMatches(scene, query)) matches.push({ pageId: page.id, pageName: page.name, elementId });
  }
  return matches;
}
