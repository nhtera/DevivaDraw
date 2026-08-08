/**
 * Uniform plain-text label read for any element that can carry one — the single accessor
 * `apps/web`'s (future) diagram-extraction path and `tools/text-tool.ts`'s siblings both rely on
 * instead of each re-deriving "is this a text element, or a container with a bound one".
 *
 * Two-argument (`element`, `scene`) rather than a one-arg `getLabel(element)`: a container only
 * stores a `{id, type}` ref in `boundElements` (see `bound-text.ts`), never the label string itself,
 * so resolving the actual text needs a `Scene` lookup — the same pattern every other cross-element
 * reference in this codebase (`containerId`, `boundElements`) already uses, resolved through `Scene`
 * rather than denormalized onto the element.
 */
import type { AnyElement } from "../elements/element-types";
import type { Scene } from "../scene/scene";

/**
 * Returns `element`'s plain-text label: a `TextElement` returns its own `text`; any other element
 * with a bound `TextElement` (via `boundElements`) returns that child's `text`; everything else
 * (no label, or a bound-text ref pointing at a deleted/missing/non-text element) returns `""`.
 */
export function getLabel(element: AnyElement, scene: Scene): string {
  if (element.type === "text") return element.text;

  const boundTextRef = element.boundElements?.find((ref) => ref.type === "text");
  if (!boundTextRef) return "";

  const boundText = scene.getElement(boundTextRef.id);
  if (!boundText || boundText.isDeleted || boundText.type !== "text") return "";
  return boundText.text;
}
