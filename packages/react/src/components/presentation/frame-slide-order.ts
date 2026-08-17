/**
 * Frames → the ordered slide list a presentation walks.
 *
 * Order is the frames' own scene order (their z-order index, which is creation order for anything
 * the user has not restacked), overridable by a numeric prefix in the frame's name: `"1. Intro"`,
 * `"2 Results"`, `"10) Summary"`. That keeps ordering a zero-schema-change feature — renaming a
 * frame is the whole interaction, and a document authored by an older build presents fine.
 *
 * Numbered frames always sort ahead of unnumbered ones rather than interleaving by position: a deck
 * that is half-numbered is a deck mid-way through being ordered, and the numbers the user has
 * actually typed are the stronger signal about intent than wherever those frames happen to sit.
 *
 * Pure and scene-free — it takes plain frame records so it can be unit-tested without a `Scene`.
 */

export interface SlideFrame {
  id: string;
  name: string;
}

/**
 * A scene's live frame elements in slide order — the one definition of "which frame is first", shared
 * by the presentation walk and the export dialog's current-frame scope so the two cannot disagree
 * about it. (They did: export used raw scene order while presentation used this ordering, so a
 * numbered deck exported the wrong frame.)
 */
export function orderedSceneFrames<T extends { id: string; type: string; isDeleted: boolean; name?: string }>(elements: readonly T[]): T[] {
  const frames = elements.filter((element) => element.type === "frame" && !element.isDeleted);
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  return orderFramesAsSlides(frames.map((frame) => ({ id: frame.id, name: frame.name ?? "" }))).map((slide) => byId.get(slide.id)!);
}

export interface Slide extends SlideFrame {
  /** The parsed leading number, or `null` for an unnumbered frame. */
  order: number | null;
}

/**
 * A leading integer followed by a separator (`.`, `)`, `-`, `:`), whitespace, or end of name.
 *
 * Whitespace counts because `"1 Intro"` is one of the most natural ways to number a slide, and a
 * bare `"3"` counts because a frame named just its number is unambiguous. The consequence, accepted
 * deliberately: a name that *opens* with a year — `"2026 Roadmap"` — is read as slide 2026 and sorts
 * to the end of the numbered frames. Ordering stays deterministic and the frame still presents; the
 * fix, if it ever matters to someone, is to rename the frame. Requiring a non-space separator
 * instead would break the far more common `"1 Intro"`, which is the worse trade.
 *
 * Digits fused to letters (`"2026Roadmap"`) are NOT a slide number — that is what the separator
 * requirement does rule out.
 */
const NUMERIC_PREFIX = /^\s*(\d+)\s*(?:[.):\-\s]|$)/;

/** The slide number encoded in `name`, or `null` when it carries none. */
export function parseSlideNumber(name: string): number | null {
  const match = NUMERIC_PREFIX.exec(name);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * `frames` (already in scene order) as the ordered slide list.
 *
 * Ties — two frames claiming the same number, or any two unnumbered frames — keep their incoming
 * relative order, so the result is deterministic and never reshuffles frames the user has not
 * distinguished from each other.
 */
export function orderFramesAsSlides(frames: readonly SlideFrame[]): Slide[] {
  const slides = frames.map((frame, position) => ({ ...frame, order: parseSlideNumber(frame.name), position }));
  return slides
    .sort((a, b) => {
      if (a.order !== null && b.order !== null) return a.order === b.order ? a.position - b.position : a.order - b.order;
      if (a.order !== null) return -1;
      if (b.order !== null) return 1;
      return a.position - b.position;
    })
    .map(({ id, name, order }) => ({ id, name, order }));
}
