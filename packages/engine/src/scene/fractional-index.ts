/**
 * Fractional-index z-order for scene elements.
 *
 * Wraps the `fractional-indexing` lib rather than hand-rolling base62 midpoint math: that
 * algorithm is easy to get subtly wrong (index strings that grow unboundedly under repeated
 * same-position inserts is the classic bug class), and this is a small, single-purpose,
 * well-tested dependency rather than a framework.
 *
 * The four `move*` helpers below compute the *new* index string for a target item; they do not
 * mutate anything themselves. A future phase wires them into `Scene` (e.g.
 * `scene.updateElement(id, { index: moveToFront(scene.getElements(), id) })`) once there is a UI
 * action (bring-to-front, send-backward, ...) driving them — implemented and tested now so that
 * wiring is a one-line call, not new algorithm design.
 */
import { generateKeyBetween } from "fractional-indexing";

/** Returns a fresh index key that sorts strictly between `a` and `b`. Either bound may be `null`. */
export function indexBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b);
}

export interface IndexedItem {
  id: string;
  index: string;
}

function sortByIndex<T extends IndexedItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
}

/** New index that places `id` after every other item (top of z-order / drawn last). */
export function moveToFront<T extends IndexedItem>(items: readonly T[], id: string): string {
  const sorted = sortByIndex(items.filter((item) => item.id !== id));
  const last = sorted.at(-1);
  return indexBetween(last ? last.index : null, null);
}

/** New index that places `id` before every other item (bottom of z-order / drawn first). */
export function moveToBack<T extends IndexedItem>(items: readonly T[], id: string): string {
  const sorted = sortByIndex(items.filter((item) => item.id !== id));
  const first = sorted[0];
  return indexBetween(null, first ? first.index : null);
}

/**
 * New index that swaps `id` one step toward the front, past its immediate neighbor.
 * Returns `undefined` if `id` is not found or is already frontmost (nothing to swap past).
 */
export function moveForward<T extends IndexedItem>(items: readonly T[], id: string): string | undefined {
  const sorted = sortByIndex(items);
  const position = sorted.findIndex((item) => item.id === id);
  if (position === -1) return undefined;
  const next = sorted[position + 1];
  if (!next) return undefined;
  const afterNext = sorted[position + 2];
  return indexBetween(next.index, afterNext ? afterNext.index : null);
}

/**
 * New index that swaps `id` one step toward the back, before its immediate neighbor.
 * Returns `undefined` if `id` is not found or is already backmost (nothing to swap before).
 */
export function moveBackward<T extends IndexedItem>(items: readonly T[], id: string): string | undefined {
  const sorted = sortByIndex(items);
  const position = sorted.findIndex((item) => item.id === id);
  if (position <= 0) return undefined;
  const previous = sorted[position - 1];
  if (!previous) return undefined;
  const beforePrevious = sorted[position - 2];
  return indexBetween(beforePrevious ? beforePrevious.index : null, previous.index);
}
