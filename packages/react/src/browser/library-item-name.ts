/**
 * Naming and searching library items by what is actually *in* them.
 *
 * Neither of the two library formats guarantees a name. Excalidraw's v1 envelope has no field for one
 * at all (it is a bare array of element arrays), and plenty of v2 items leave it unset — so falling
 * back to a positional `"Item 7"` labels the whole shelf with strings that carry no information. That
 * makes the search box useless in exactly the case it exists for: a real imported set, where nothing
 * matches any word the user would think to type.
 *
 * A labelled diagram shape almost always carries its own name as text — "Load Balancer", "Relational
 * DB", "CDN". The largest text is the title and the smaller ones are annotations (an IP under a "DNS"
 * heading, a legend under a chart), so size, not document order, is what picks it out. Punctuation-only
 * text is skipped: decorative braces around a "Document DB" label are typically set larger than the
 * label itself and would otherwise win.
 *
 * Search then matches the name *or* any text inside the item, so an item is still findable by an
 * annotation that lost the title contest, and one whose title was truncated is findable by its full
 * wording.
 */
import type { AnyElement } from "@deviva-draw/engine";
import type { LibraryItem } from "./library-storage";

/** Beyond this a name stops being a tooltip and starts being a paragraph — see the lorem-ipsum blocks real libraries ship. */
const MAX_NAME_LENGTH = 32;

/** Collapses the newlines a wrapped label stores ("Load\nBalancer") into the single line a name is. */
function flatten(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Has at least one letter or digit — i.e. is a label rather than decoration ("{", "—", "..."). */
function isMeaningful(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** Every usable label inside an item, in document order, flattened to single lines. */
export function libraryItemTexts(elements: readonly AnyElement[]): string[] {
  const texts: string[] = [];
  for (const element of elements) {
    if (element.type !== "text" || element.isDeleted) continue;
    const text = flatten(element.text);
    if (text !== "" && isMeaningful(text)) texts.push(text);
  }
  return texts;
}

/** The item's biggest label — its title. `null` when it carries no text at all (a pure shape). */
function titleTextOf(elements: readonly AnyElement[]): string | null {
  let best: { text: string; fontSize: number } | null = null;
  for (const element of elements) {
    if (element.type !== "text" || element.isDeleted) continue;
    const text = flatten(element.text);
    if (text === "" || !isMeaningful(text)) continue;
    // Strictly greater, so equal-sized labels keep document order rather than the last one winning.
    if (best === null || element.fontSize > best.fontSize) best = { text, fontSize: element.fontSize };
  }
  return best?.text ?? null;
}

/**
 * A display name for a set of elements: its own title text, or `fallback` for a pure shape that has
 * none. Long titles are cut rather than dropped — a truncated name still reads, and search covers the
 * rest of the wording anyway.
 */
export function deriveLibraryItemName(elements: readonly AnyElement[], fallback: string): string {
  const title = titleTextOf(elements);
  if (title === null) return fallback;
  if (title.length <= MAX_NAME_LENGTH) return title;

  // Cut at the last word boundary inside the limit rather than mid-word ("…sit amet,…" over
  // "…sit amet, con…"); a single word longer than the whole limit has no boundary to use, so it takes
  // the hard cut.
  const head = title.slice(0, MAX_NAME_LENGTH - 1);
  const lastSpace = head.lastIndexOf(" ");
  return `${(lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

/** `true` when `needle` (already lowercased and trimmed) hits the item's name or any label inside it. An empty needle matches everything. */
export function libraryItemMatches(item: LibraryItem, needle: string): boolean {
  if (needle === "") return true;
  if (item.name.toLowerCase().includes(needle)) return true;
  return libraryItemTexts(item.elements).some((text) => text.toLowerCase().includes(needle));
}
