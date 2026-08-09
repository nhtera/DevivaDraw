/**
 * Maps a live Deviva Draw scene to the generic shape/binding vocabulary an embedding host's own
 * diagram-extraction pipeline expects — the same tool-agnostic contract every other drawing surface
 * that pipeline has fed (a "geo" shape carrying `props.geo`, a `parentId` for grouping, plain-text
 * labels, arrowhead strings, and `{fromId, toId, terminal}` bindings). Kept free of any host-specific
 * type import (no `@deviva/shared` or similar): the types below are a structural mirror a consumer's
 * own extraction function can accept without this package depending on that consumer at all.
 *
 * `parentId` is always `"page"` — Deviva Draw's `groupIds` (a Cmd+G selection group) are a disjoint
 * id space from element ids, but a host's extractor (e.g. `extractDiagram`) only ever recognizes a
 * `parentId` that equals another kept shape's own `id` (its "a frame is itself a node" grouping
 * model). Passing a real `groupIds` entry through would silently resolve to nothing there anyway, so
 * this deliberately never surfaces group membership — matching the prior Excalidraw-era adapter,
 * which only ever grouped via frame elements (a concept Deviva Draw doesn't have yet), never via
 * Cmd+G groups either.
 */
import type { AnyElement } from "@deviva-draw/engine";

/** A scene element reduced to what makes it a diagram component — mirrors a generic drawing-tool shape record. */
export interface CanvasShapeInput {
  id: string;
  /** `"geo"` for rectangle/ellipse/diamond, else the element's own type (`text`, `arrow`, `freedraw`, `image`, `line`, `generic`). */
  type: string;
  /** Always `"page"` — see the module doc for why group membership deliberately does not surface here. */
  parentId: string;
  props: CanvasShapeProps;
}

export interface CanvasShapeProps {
  /** Which geometric form a `"geo"` shape was drawn as — Deviva Draw's own `rectangle`/`ellipse`/`diamond` type string, unchanged. */
  geo?: string;
  /** Plain-text label, for shapes/arrows that carry one (own text, or a bound-text child's). */
  text?: string;
  arrowheadStart?: string;
  arrowheadEnd?: string;
}

/** One end of an arrow, fastened to a shape by the scene's binding model. */
export interface CanvasArrowBindingInput {
  /** The arrow. */
  fromId: string;
  /** The shape it is fastened to. */
  toId: string;
  terminal: "start" | "end";
}

export interface ToCanvasShapeInputResult {
  shapes: CanvasShapeInput[];
  bindings: CanvasArrowBindingInput[];
}

/** Element types that read as a drawn geometric component (mapped to the generic `"geo"` type). */
const GEO_ELEMENT_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

/** The synthetic parent id for anything not inside a group — matches an ungrouped element's absence of a `parentId` in tools that model the page itself as a container. */
const PAGE_PARENT_ID = "page";

/**
 * Reads every live (non-deleted) element into the generic shape/binding vocabulary. Bound text
 * (`containerId` set — a label on a shape or an arrow, see `text-element.ts`/`arrow-label.ts`) is
 * folded into its container's `props.text` and never appears as its own shape, matching how a
 * standalone `TextElement` (`containerId === null`) does appear as one.
 */
export function toCanvasShapeInput(elements: readonly AnyElement[]): ToCanvasShapeInputResult {
  const live = elements.filter((element) => !element.isDeleted);

  const labelByContainer = new Map<string, string>();
  for (const element of live) {
    if (element.type !== "text" || !element.containerId) continue;
    labelByContainer.set(element.containerId, element.text);
  }

  const shapes: CanvasShapeInput[] = [];
  const bindings: CanvasArrowBindingInput[] = [];

  for (const element of live) {
    if (element.type === "text" && element.containerId) continue;
    shapes.push(toShapeInput(element, labelByContainer));

    if (element.type !== "arrow") continue;
    if (element.startBinding) {
      bindings.push({ fromId: element.id, toId: element.startBinding.elementId, terminal: "start" });
    }
    if (element.endBinding) {
      bindings.push({ fromId: element.id, toId: element.endBinding.elementId, terminal: "end" });
    }
  }

  return { shapes, bindings };
}

function toShapeInput(element: AnyElement, labelByContainer: ReadonlyMap<string, string>): CanvasShapeInput {
  // See the module doc: `groupIds` is deliberately never translated into `parentId`.
  const parentId = PAGE_PARENT_ID;
  const label = labelByContainer.get(element.id) ?? "";

  if (GEO_ELEMENT_TYPES.has(element.type)) {
    return { id: element.id, parentId, type: "geo", props: { geo: element.type, text: label } };
  }
  if (element.type === "text") {
    return { id: element.id, parentId, type: "text", props: { text: element.text } };
  }
  if (element.type === "arrow") {
    return {
      id: element.id,
      parentId,
      type: "arrow",
      props: { text: label, arrowheadStart: element.startArrowhead, arrowheadEnd: element.endArrowhead },
    };
  }
  // Freehand strokes, images, plain lines, and the pre-shape-system generic placeholder: passed
  // through under their own type so the host's extractor counts them as marks, not components.
  return { id: element.id, parentId, type: element.type, props: {} };
}
