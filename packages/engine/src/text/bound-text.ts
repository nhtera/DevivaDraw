/**
 * Container<->text linking, lazy bound-text creation, and the auto-grow write-back — the `Scene`-
 * aware orchestration layer over `bound-text-layout.ts`'s pure math and `text-edit-session.ts`'s
 * editing state machine. A double-click inside a rect/ellipse/diamond (dispatched by the host, e.g.
 * `apps/web`'s dev harness, since hit-testing/double-click detection is a DOM/selection concern, not
 * an engine one) calls `startBoundTextEdit`; everything else here is that call's supporting cast.
 */
import type { BoundElementRef } from "../elements/base-element";
import type { AnyElement } from "../elements/element-types";
import { createTextElement } from "../elements/text-element";
import type { TextElement, VerticalAlign } from "../elements/text-element";
import type { NoteElement } from "../elements/note-element";
import type { DiamondElement, EllipseElement, RectangleElement } from "../elements/shape-elements";
import type { Scene } from "../scene/scene";
import { TEXT_FONT_FAMILY_CSS } from "./font-loading";
import { boundTextWrapWidth, BOUND_TEXT_PADDING, layoutBoundText } from "./bound-text-layout";
import { buildFontCssString } from "./text-measurement";
import type { TextMeasurer } from "./text-measurement";
import type { TextEditSession } from "./text-edit-session";

/** Element types a `TextElement` can bind inside — arrows join this set once arrow-bound labels ship (this linking logic is written to be type-agnostic beyond this list, so extending it needs no rework). */
type BindableContainer = RectangleElement | EllipseElement | DiamondElement | NoteElement;
/**
 * Exported so `bindings/shape-outline-geometry.test.ts` can assert every one of these is also
 * bind-geometry-capable. The two lists answer different questions and are allowed to differ in size,
 * but this one must stay a subset — when it silently wasn't, dropping an arrow on a note threw.
 */
export const BINDABLE_CONTAINER_TYPES: ReadonlySet<string> = new Set(["rectangle", "ellipse", "diamond", "note"]);

export function isBindableContainer(element: AnyElement): element is BindableContainer {
  return BINDABLE_CONTAINER_TYPES.has(element.type);
}

/** The container's own bound-text ref (`{id, type: "text"}`), or `null` if it has none. */
export function findBoundTextRef(container: AnyElement): BoundElementRef | null {
  return container.boundElements?.find((ref) => ref.type === "text") ?? null;
}

/**
 * Replaces `container`'s bound-text ref (a container has at most one label) with one pointing at
 * `textId`. Exported (not just used internally by `getOrCreateBoundText`) so `bindings/arrow-label.ts`
 * can reuse the exact same ref-bookkeeping for arrow labels — an arrow "container" needs its own
 * midpoint-centered layout (not the padded-box wrap this file's `layoutBoundText`/
 * `growContainerToFitText` assume), but the underlying `boundElements` linking is identical for any
 * container type.
 */
export function bindTextToContainer(scene: Scene, containerId: string, textId: string): void {
  const container = scene.getElement(containerId);
  if (!container) return;
  const withoutStaleTextRef = (container.boundElements ?? []).filter((ref) => ref.type !== "text");
  scene.updateElement(containerId, { boundElements: [...withoutStaleTextRef, { id: textId, type: "text" }] });
}

/** Drops `textId` from `containerId`'s bound-text ref — used when a bound-text edit commits to an empty draft (the draft gets deleted; the container must stop pointing at it) and by `deleteContainerAndBoundText`. */
export function unbindTextFromContainer(scene: Scene, containerId: string, textId: string): void {
  const container = scene.getElement(containerId);
  if (!container?.boundElements) return;
  scene.updateElement(containerId, {
    boundElements: container.boundElements.filter((ref) => !(ref.id === textId && ref.type === "text")),
  });
}

export interface BoundTextResult {
  textElementId: string;
  initialText: string;
  isNewElement: boolean;
}

/**
 * Resolves `containerId`'s existing bound text, or lazily creates one (centered, middle-aligned,
 * empty) the first time a container is double-clicked. Throws for a non-bindable/missing container —
 * a caller bug (the host must only invoke this from a double-click already hit-tested against a
 * rect/ellipse/diamond), not a runtime condition to degrade from silently.
 */
export function getOrCreateBoundText(scene: Scene, containerId: string): BoundTextResult {
  const container = scene.getElement(containerId);
  if (!container || !isBindableContainer(container)) {
    throw new Error(`bound-text: "${containerId}" is not a bindable container`);
  }

  const existingRef = findBoundTextRef(container);
  if (existingRef) {
    const existing = scene.getElement(existingRef.id);
    if (existing && !existing.isDeleted && existing.type === "text") {
      return { textElementId: existing.id, initialText: existing.text, isNewElement: false };
    }
  }

  const created = createTextElement({
    x: container.x + BOUND_TEXT_PADDING,
    y: container.y + BOUND_TEXT_PADDING,
    width: boundTextWrapWidth(container),
    height: 0,
    textAlign: "center",
    verticalAlign: "middle",
    containerId,
  });
  const stored = scene.addElement(created);
  bindTextToContainer(scene, containerId, stored.id);
  return { textElementId: stored.id, initialText: "", isNewElement: true };
}

function verticalOffsetForAlign(verticalAlign: VerticalAlign, containerHeight: number, textHeightPx: number): number {
  switch (verticalAlign) {
    case "top":
      return BOUND_TEXT_PADDING;
    case "bottom":
      return containerHeight - textHeightPx - BOUND_TEXT_PADDING;
    case "middle":
      return (containerHeight - textHeightPx) / 2;
  }
}

/**
 * Re-wraps `text` against `containerId`'s current width, grows the container's height to fit (never
 * shrinks — see `layoutBoundText`'s doc), and repositions/resizes the bound text element to match.
 * Called after every bound-text commit; also the hook a future container-resize tool re-runs
 * whenever the container's own width/height changes out from under an already-wrapped label.
 */
export function growContainerToFitText(scene: Scene, containerId: string, text: string, measurer: TextMeasurer): void {
  const container = scene.getElement(containerId);
  const textRef = container ? findBoundTextRef(container) : null;
  if (!container || !textRef) return;
  const textElement = scene.getElement(textRef.id);
  if (!textElement || textElement.type !== "text") return;

  const fontCss = buildFontCssString(textElement.fontSize, TEXT_FONT_FAMILY_CSS[textElement.fontFamily]);
  const layout = layoutBoundText(text, container, measurer, fontCss, textElement.fontSize, textElement.lineHeight);

  if (layout.requiredContainerHeight !== container.height) {
    scene.updateElement(containerId, { height: layout.requiredContainerHeight });
  }

  const changes: Partial<TextElement> = {
    text,
    x: container.x + BOUND_TEXT_PADDING,
    y: container.y + verticalOffsetForAlign(textElement.verticalAlign, layout.requiredContainerHeight, layout.textHeightPx),
    width: boundTextWrapWidth(container),
    height: layout.textHeightPx,
  };
  scene.updateElement(textRef.id, changes);
}

/** `TextEditSession`'s `onCommitted` callback for a bound-text session: unbinds a discarded-empty draft, otherwise re-runs the grow/wrap. */
function syncBoundTextAfterCommit(scene: Scene, containerId: string, textId: string, finalText: string, measurer: TextMeasurer): void {
  const container = scene.getElement(containerId);
  if (!container) return;

  const textElement = scene.getElement(textId);
  if (!textElement || textElement.isDeleted) {
    unbindTextFromContainer(scene, containerId, textId);
    return;
  }

  growContainerToFitText(scene, containerId, finalText, measurer);
}

/** Opens (or resumes) editing `containerId`'s bound text via `session` — the entry point a double-click handler calls. */
export function startBoundTextEdit(scene: Scene, session: TextEditSession, containerId: string, measurer: TextMeasurer): void {
  const { textElementId, initialText, isNewElement } = getOrCreateBoundText(scene, containerId);
  session.start({
    elementId: textElementId,
    initialText,
    isNewElement,
    onCommitted: (elementId, finalText) => syncBoundTextAfterCommit(scene, containerId, elementId, finalText, measurer),
  });
}

/** Soft-deletes `containerId` and its bound text together — a label has no meaning once its container is gone, so it must not survive as an orphaned standalone-looking text element. */
export function deleteContainerAndBoundText(scene: Scene, containerId: string): void {
  const container = scene.getElement(containerId);
  if (!container) return;
  const textRef = findBoundTextRef(container);
  scene.deleteElement(containerId);
  if (textRef) scene.deleteElement(textRef.id);
}
