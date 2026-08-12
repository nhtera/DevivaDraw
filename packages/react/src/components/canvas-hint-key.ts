/**
 * Picks which hint the canvas shows, from the whole interaction state rather than the active tool
 * alone. Keyed on the tool *plus* whether anything is selected and whether text is being typed,
 * because those are three different situations with three different next moves — with the select tool
 * active, "drag to select an area" is the wrong sentence the instant something is already selected.
 *
 * Pure, so the mapping is unit-testable without rendering anything. Returns `null` when there is
 * nothing useful to say: a tool with no hint of its own renders no hint at all, rather than an empty
 * line of chrome (or, as before, a missing catalog entry resolving to nothing).
 */
import { catalogEn } from "../i18n/catalog-en";
import type { TranslationKey } from "../i18n/catalog-en";

export interface CanvasHintState {
  tool: string;
  hasSelection: boolean;
  isEditingText: boolean;
}

export function canvasHintKey(state: CanvasHintState): TranslationKey | null {
  // Typing wins over everything: the tool underneath is irrelevant while there is a caret on screen.
  if (state.isEditingText) return "hint.editingText";
  if (state.tool === "select" && state.hasSelection) return "hint.selection";

  // Checked against the catalog rather than a list kept here, so a hint added for a tool starts
  // showing up on its own and one that is missing degrades to silence.
  const key = `hint.${state.tool}`;
  return Object.hasOwn(catalogEn, key) ? (key as TranslationKey) : null;
}
