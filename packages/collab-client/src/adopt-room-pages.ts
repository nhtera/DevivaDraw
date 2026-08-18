/**
 * What a peer does with its own page list the moment it joins somebody else's room.
 *
 * The pages manifest is an LWW union, and that union is right for two people editing together: when
 * one of them adds a page, nobody else's page should vanish. It is wrong for the instant of joining.
 * A client that has never drawn anything still owns one empty starter page, and the union means that
 * page lands in the room — so every join leaves a stray "Page 1" on everyone else's board, and the
 * joiner starts out looking at their own blank page instead of the board they came to see.
 *
 * So: wait (briefly) for the room's own pages to arrive, and if this peer's original page is still
 * the untouched starter, switch to the room's first page and drop it. A peer that HAD drawn before
 * joining keeps everything — the union is correct again the moment there is work to lose.
 *
 * Lives here rather than in either caller because both the browser shell and the headless MCP
 * bridge join rooms and both need the identical answer; this was the bridge's private method until
 * the browser turned out to need it too.
 */
import type { PageStore } from "./page-store";

/** How long to wait for the room's page list before concluding the room is genuinely empty. */
export const DEFAULT_PAGE_ADOPT_TIMEOUT_MS = 2_000;

export interface AdoptRoomPagesOptions {
  /** Page ids this peer had before it joined — captured by the caller BEFORE `joinSession`, since afterwards the room's pages are indistinguishable from its own. */
  preJoinPageIds: ReadonlySet<string>;
  /** The page this peer was on before joining. */
  preJoinActiveId: string;
  timeoutMs?: number;
}

/**
 * Resolves once this peer has either adopted the room's pages or decided it has nothing to adopt.
 * Never throws and never blocks a caller indefinitely: an empty room simply times out, leaving this
 * peer's own page as the board, which is the correct outcome for being first to arrive.
 */
export async function adoptRoomPages(store: PageStore, options: AdoptRoomPagesOptions): Promise<void> {
  const { preJoinPageIds, preJoinActiveId } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAGE_ADOPT_TIMEOUT_MS;
  const roomPages = () => store.getPages().filter((page) => !preJoinPageIds.has(page.id));
  const start = Date.now();

  while (roomPages().length === 0) {
    // A wholesale manifest adoption may have replaced the list (tombstoning this peer's page)
    // already — that IS the adopted state, so there is nothing left to do.
    if (!store.getPages().some((page) => page.id === preJoinActiveId)) return;
    if (Date.now() - start > timeoutMs) return; // empty room — this peer's page is the board
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const ownPages = store.getPages().filter((page) => preJoinPageIds.has(page.id));
  const originalScene = store.getSceneById(preJoinActiveId);
  // "Untouched" is deliberately strict: exactly one own page, still the active one, still empty.
  // Anything else means there is work here, and discarding somebody's work to tidy a page list is
  // never the right trade.
  const untouched = ownPages.length === 1 && ownPages[0]!.id === preJoinActiveId && originalScene !== null && [...originalScene.elementsUnsorted()].length === 0;
  if (!untouched) return;

  store.setActivePage(roomPages()[0]!.id);
  store.removePage(preJoinActiveId);
}
