/**
 * Shared entry point for creating a standalone (non-bound) text element and opening its edit session —
 * used both by the text tool (click-to-place) and by double-clicking empty canvas with the select tool
 * (the "double-click anywhere to add text" affordance every mainstream whiteboard has). Factored out of
 * `tools/text-tool.ts` so both call sites size the committed text identically.
 */
import { createTextElement } from "../elements/text-element";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { TEXT_FONT_FAMILY_CSS } from "./font-loading";
import type { TextEditSession } from "./text-edit-session";
import { buildFontCssString, measureWrappedText } from "./text-measurement";
import type { TextMeasurer } from "./text-measurement";

/** Standalone text never wraps except at explicit `\n` (see `text-measurement.ts`'s `wrapText` doc on `maxWidth: Infinity`) — its box just grows to fit whatever the user typed, so its `width`/`height` (left at `0` on creation) are measured back on commit for rotation/alignment/hit-testing. */
export function syncStandaloneTextSize(scene: Scene, elementId: string, finalText: string, measurer: TextMeasurer): void {
  const element = scene.getElement(elementId);
  if (!element || element.isDeleted || element.type !== "text") return;

  const fontCss = buildFontCssString(element.fontSize, TEXT_FONT_FAMILY_CSS[element.fontFamily]);
  const metrics = measureWrappedText(finalText, {
    measurer,
    fontCss,
    fontSizePx: element.fontSize,
    lineHeightMultiplier: element.lineHeight,
    maxWidth: Number.POSITIVE_INFINITY,
  });
  scene.updateElement(elementId, { width: metrics.widthPx, height: metrics.totalHeightPx });
}

export interface StandaloneTextStyle {
  strokeColor: string;
  opacity: number;
}

/** Adds an empty text element at `point`, opens its edit session (sizing it on commit), and returns the new element's id. */
export function startStandaloneTextEdit(scene: Scene, editSession: TextEditSession, measurer: TextMeasurer, point: Point, style: StandaloneTextStyle): string {
  const stored = scene.addElement(createTextElement({ x: point.x, y: point.y, strokeColor: style.strokeColor, opacity: style.opacity }));
  editSession.start({
    elementId: stored.id,
    initialText: "",
    isNewElement: true,
    onCommitted: (elementId, finalText) => syncStandaloneTextSize(scene, elementId, finalText, measurer),
  });
  return stored.id;
}

/**
 * Re-opens editing on an *existing* standalone text element (double-clicking its glyphs to edit the
 * content), seeding the draft with its current text so typing appends/edits rather than replacing from
 * blank. Without this, a double-click on already-committed standalone text misses every bindable/arrow
 * hit test and falls through to `startStandaloneTextEdit`, spawning a second overlapping text box
 * offset to the click point instead of editing the one that's there — the "text jumps to a new spot on
 * edit" duplicate. `isNewElement: false` so abandoning the edit (Escape) leaves the original intact.
 */
export function startExistingStandaloneTextEdit(scene: Scene, editSession: TextEditSession, measurer: TextMeasurer, elementId: string): void {
  const element = scene.getElement(elementId);
  if (!element || element.isDeleted || element.type !== "text") return;
  editSession.start({
    elementId,
    initialText: element.text,
    isNewElement: false,
    onCommitted: (id, finalText) => syncStandaloneTextSize(scene, id, finalText, measurer),
  });
}
