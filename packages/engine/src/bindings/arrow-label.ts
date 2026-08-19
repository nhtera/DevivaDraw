/**
 * Bound labels for arrows: reuses `text/bound-text.ts`'s `boundElements` linking (`bindTextToContainer`/
 * `findBoundTextRef`/`unbindTextFromContainer`) and `text/text-edit-session.ts`'s editing state
 * machine wholesale — an arrow "container" needs its own layout, though: a rect/ellipse/diamond's
 * bound text wraps inside a padded box and grows the container to fit (`bound-text-layout.ts`), but an
 * arrow's label has no box to wrap into — it's a single unwrapped block centered on the arrow's
 * current midpoint (`render/arrow-geometry.ts`'s `arcLengthMidpoint`), same "natural size" measurement
 * standalone text uses (`tools/text-tool.ts`'s `syncStandaloneTextSize`). `recenterArrowLabelIfPresent`
 * is the "recompute on change" hook `bindings/binding-scene-sync.ts` calls after every arrow geometry
 * update, so a label re-centers on reroute exactly like an endpoint binding does.
 */
import type { ArrowElement } from "../elements/arrow-element";
import { createTextElement } from "../elements/text-element";
import type { TextElement } from "../elements/text-element";
import { absolutePoints, arcLengthMidpoint } from "../render/arrow-geometry";
import type { Scene } from "../scene/scene";
import { TEXT_FONT_FAMILY_CSS } from "../text/font-loading";
import { bindTextToContainer, findBoundTextRef, unbindTextFromContainer } from "../text/bound-text";
import type { TextEditSession } from "../text/text-edit-session";
import { buildFontCssString, measureWrappedText } from "../text/text-measurement";
import type { TextMeasurer } from "../text/text-measurement";

export interface ArrowLabelResult {
  textElementId: string;
  initialText: string;
  isNewElement: boolean;
}

function arrowMidpoint(arrow: Pick<ArrowElement, "x" | "y" | "points">): { x: number; y: number } {
  return arcLengthMidpoint(absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points));
}

/**
 * Resolves `arrowId`'s existing bound label, or lazily creates one (empty, centered on the arrow's
 * current midpoint) the first time it's double-clicked. Throws for a missing/non-arrow id — a caller
 * bug (the host must only invoke this from a double-click already hit-tested against a live arrow),
 * mirroring `getOrCreateBoundText`'s same contract for shape containers.
 */
export function getOrCreateArrowLabel(scene: Scene, arrowId: string): ArrowLabelResult {
  const arrow = scene.getElement(arrowId);
  if (!arrow || arrow.type !== "arrow") {
    throw new Error(`arrow-label: "${arrowId}" is not a live arrow`);
  }

  const existingRef = findBoundTextRef(arrow);
  if (existingRef) {
    const existing = scene.getElement(existingRef.id);
    if (existing && !existing.isDeleted && existing.type === "text") {
      return { textElementId: existing.id, initialText: existing.text, isNewElement: false };
    }
  }

  const midpoint = arrowMidpoint(arrow);
  const created = createTextElement({ x: midpoint.x, y: midpoint.y, width: 0, height: 0, textAlign: "center", verticalAlign: "middle", containerId: arrowId });
  const stored = scene.addElement(created);
  bindTextToContainer(scene, arrowId, stored.id);
  return { textElementId: stored.id, initialText: "", isNewElement: true };
}

/** Re-measures `text` at its natural (unwrapped) size and repositions it centered on `arrowId`'s current midpoint. */
function recenterArrowLabel(scene: Scene, arrow: ArrowElement, textElement: TextElement, text: string, measurer: TextMeasurer): void {
  const fontCss = buildFontCssString(textElement.fontSize, TEXT_FONT_FAMILY_CSS[textElement.fontFamily]);
  const metrics = measureWrappedText(text, {
    measurer,
    fontCss,
    fontSizePx: textElement.fontSize,
    lineHeightMultiplier: textElement.lineHeight,
    maxWidth: Number.POSITIVE_INFINITY,
  });
  const midpoint = arrowMidpoint(arrow);
  const changes: Partial<TextElement> = {
    text,
    x: midpoint.x - metrics.widthPx / 2,
    y: midpoint.y - metrics.totalHeightPx / 2,
    width: metrics.widthPx,
    height: metrics.totalHeightPx,
  };
  // Writing only a real change is what lets `binding-scene-sync.ts` re-center from a *label* update
  // as well as an arrow one: an unconditional write there would re-enter this hook forever, since the
  // element it writes is the element that triggered it. Same idempotency argument
  // `text/bound-text-container-sync.ts` relies on, and it also spares the churn of an arrow update
  // that never moved the midpoint.
  if (
    textElement.text === changes.text &&
    textElement.x === changes.x &&
    textElement.y === changes.y &&
    textElement.width === changes.width &&
    textElement.height === changes.height
  ) {
    return;
  }
  scene.updateElement(textElement.id, changes);
}

/** If `arrowId` (a live, non-deleted arrow) has a bound label, re-centers it on the arrow's current midpoint. No-ops otherwise — safe to call unconditionally after any arrow geometry change. */
export function recenterArrowLabelIfPresent(scene: Scene, arrowId: string, measurer: TextMeasurer): void {
  const arrow = scene.getElement(arrowId);
  if (!arrow || arrow.type !== "arrow" || arrow.isDeleted) return;
  const ref = findBoundTextRef(arrow);
  if (!ref) return;
  const textElement = scene.getElement(ref.id);
  if (!textElement || textElement.isDeleted || textElement.type !== "text") return;
  recenterArrowLabel(scene, arrow, textElement, textElement.text, measurer);
}

/** `TextEditSession`'s `onCommitted` callback for an arrow-label session: unbinds a discarded-empty draft, otherwise re-centers it. */
function syncArrowLabelAfterCommit(scene: Scene, arrowId: string, textId: string, finalText: string, measurer: TextMeasurer): void {
  const arrow = scene.getElement(arrowId);
  if (!arrow || arrow.type !== "arrow") return;

  const textElement = scene.getElement(textId);
  if (!textElement || textElement.isDeleted) {
    unbindTextFromContainer(scene, arrowId, textId);
    return;
  }
  recenterArrowLabel(scene, arrow, textElement as TextElement, finalText, measurer);
}

/** Opens (or resumes) editing `arrowId`'s bound label via `session` — the entry point a double-click-on-an-arrow handler calls. */
export function startArrowLabelEdit(scene: Scene, session: TextEditSession, arrowId: string, measurer: TextMeasurer): void {
  const { textElementId, initialText, isNewElement } = getOrCreateArrowLabel(scene, arrowId);
  session.start({
    elementId: textElementId,
    initialText,
    isNewElement,
    onCommitted: (elementId, finalText) => syncArrowLabelAfterCommit(scene, arrowId, elementId, finalText, measurer),
  });
}
