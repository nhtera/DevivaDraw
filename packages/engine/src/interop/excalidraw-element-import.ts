/**
 * Converts Excalidraw elements into Deviva Draw ones. Used by the `.excalidrawlib` library import
 * (`excalidraw-library-import.ts`); the element mapping is kept separate from the file envelope so a
 * `.excalidraw` *scene* import can reuse it unchanged — both formats carry the same element array.
 *
 * Two rules shape everything here:
 *
 * 1. **Never produce a dangling reference.** Elements with no Deviva Draw equivalent (images, whose
 *    pixels live in a `files` sidecar a library item has nowhere to put, and the transient
 *    `selection` element) are dropped, so every id a survivor points at — bound text, an arrow
 *    binding, a container — is re-checked against what actually survived and cleared if it didn't.
 *    That is the invariant `bindings/binding-model.ts` protects, and imported data has to honour it
 *    on arrival rather than relying on a later repair pass.
 * 2. **Ids are kept as-is.** Callers insert through `selection/clipboard.ts`'s `insertElements`,
 *    which mints fresh ids and remaps these mutual references itself. Rewriting them here would be
 *    duplicated work, and would break the cross-references before that remap ever sees them.
 */
import type { AnyElement } from "../elements/element-types";
import type { ArrowBinding, ArrowType } from "../elements/arrow-element";
import type { BaseElement, BoundElementRef } from "../elements/base-element";
import type { FreedrawPoint } from "../elements/freedraw-element";
import type { TextElement } from "../elements/text-element";
import { DEFAULT_TEXT_LINE_HEIGHT } from "../elements/text-element";
import {
  arrowheadOf,
  fillStyleOf,
  fontFamilyOf,
  isRecord,
  num,
  relativePointsOf,
  roundnessOf,
  str,
  strokeStyleOf,
  textAlignOf,
  verticalAlignOf,
} from "./excalidraw-schema";
import type { RawExcalidrawElement } from "./excalidraw-schema";

export interface ExcalidrawElementsImport {
  elements: AnyElement[];
  /** Source element types with no Deviva Draw equivalent, and how many of each were dropped. */
  skipped: Record<string, number>;
}

export interface ImportExcalidrawElementsOptions {
  /**
   * File ids whose bytes the caller actually has, from the document's `files` sidecar. An `image`
   * element is only importable when its `fileId` is in here — a scene file carries the sidecar, a
   * library item has nowhere to put one, so the same element is importable from the first and
   * correctly skipped from the second. Omitted ⇒ no files ⇒ every image is skipped.
   */
  availableFileIds?: ReadonlySet<string>;
}

/** Shapes that map one-to-one, sharing `BaseElement` with nothing extra to translate. */
const PLAIN_SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Group nesting, flipped into this document's order. The two formats agree on what `groupIds` means
 * but not on which end is which: Excalidraw appends each new group, so its array runs
 * innermost-to-outermost, while `BaseElement.groupIds` runs outermost-first — `groupSelection`
 * prepends, and `expandToGroupMembers` reads index 0 as the group a click expands to.
 *
 * Copied through verbatim, an imported shape would therefore expand to its *innermost* subgroup:
 * clicking a published icon grabs one cluster of strokes inside it instead of the whole shape, and
 * dragging pulls that cluster out of the drawing it belongs to.
 */
function groupIdsOf(raw: RawExcalidrawElement): string[] {
  return stringArray(raw.groupIds).reverse();
}

/**
 * Store-owned bookkeeping is left at the same pre-insert sentinels `createElementBase` uses, not at
 * the source file's values: an imported element is a brand-new element as far as this document's
 * history and collab merge are concerned, and carrying a foreign document's `version`/`versionNonce`
 * in would let a stale remote edit win against it. `seed` is deliberately the exception — reusing it
 * reproduces the exact sketchy strokes the drawing was authored with.
 */
function baseOf(raw: RawExcalidrawElement, fallbackId: string): Omit<BaseElement, "type"> {
  return {
    id: str(raw.id, fallbackId),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: num(raw.width, 0),
    height: num(raw.height, 0),
    angle: num(raw.angle, 0),
    strokeColor: str(raw.strokeColor, "#1e1e1e"),
    backgroundColor: str(raw.backgroundColor, "transparent"),
    fillStyle: fillStyleOf(raw),
    strokeWidth: num(raw.strokeWidth, 1),
    strokeStyle: strokeStyleOf(raw),
    roughness: num(raw.roughness, 1),
    opacity: num(raw.opacity, 100),
    roundness: roundnessOf(raw),
    seed: num(raw.seed, 0),
    groupIds: groupIdsOf(raw),
    frameId: typeof raw.frameId === "string" ? raw.frameId : null,
    boundElements: boundElementsOf(raw),
    link: typeof raw.link === "string" ? raw.link : null,
    locked: raw.locked === true,
    index: "",
    version: 0,
    versionNonce: 0,
    updated: 0,
    isDeleted: false,
  };
}

/**
 * v2's `boundElements` verbatim, or v1's `boundElementIds` widened to it. v1 stored only ids, so the
 * `type` each ref needs is unknown at this point and is filled in during the linking pass, which is
 * the first moment every element's type is known.
 */
function boundElementsOf(raw: RawExcalidrawElement): BoundElementRef[] | null {
  if (Array.isArray(raw.boundElements)) {
    const refs = raw.boundElements
      .filter(isRecord)
      .filter((ref): ref is { id: string; type: string } => typeof ref.id === "string")
      .map((ref) => ({ id: ref.id, type: str(ref.type, "") }));
    return refs.length > 0 ? refs : null;
  }
  const legacy = stringArray(raw.boundElementIds).map((id) => ({ id, type: "" }));
  return legacy.length > 0 ? legacy : null;
}

function bindingOf(value: unknown): ArrowBinding | null {
  if (!isRecord(value) || typeof value.elementId !== "string") return null;
  return { elementId: value.elementId, focus: num(value.focus, 0), gap: num(value.gap, 0) };
}

/**
 * `elbowed` is the modern explicit flag. Otherwise a rounded multi-vertex path is what Excalidraw
 * draws as a curve — a rounded *two*-point arrow has no bend to smooth and is a straight line, so
 * point count has to be part of the test rather than roundness alone.
 */
function arrowTypeOf(raw: RawExcalidrawElement, pointCount: number): ArrowType {
  if (raw.elbowed === true) return "elbow";
  return roundnessOf(raw) !== null && pointCount > 2 ? "curved" : "straight";
}

/**
 * Freedraw samples, zipping Excalidraw's two *parallel* arrays — `points: [[x, y], ...]` and a
 * separate `pressures: [p, ...]` — into this engine's `[x, y, pressure]` triples.
 *
 * The split matters: a fifth of the published libraries' ink is pen-drawn with real recorded pressure
 * and `simulatePressure: false`, so perfect-freehand takes the stored value as the stroke's width at
 * that sample. Reading pressure off `points[i][2]` (where it never lives) would hand every one of
 * those strokes a flat neutral value and flatten the taper the artist actually drew. `pressures` is
 * empty whenever pressure was simulated, in which case the neutral fallback is what the renderer
 * ignores anyway.
 */
function freedrawPointsOf(rawPoints: unknown, rawPressures: unknown): FreedrawPoint[] {
  if (!Array.isArray(rawPoints)) return [];
  const pressures = Array.isArray(rawPressures) ? rawPressures : [];
  const points: FreedrawPoint[] = [];
  rawPoints.forEach((entry, index) => {
    if (!Array.isArray(entry)) return;
    const [x, y] = entry;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
    points.push([x, y, num(pressures[index], 0.5)]);
  });
  return points;
}

/** One element, or `null` when its type has no equivalent here (the caller records the miss). */
function importElement(raw: RawExcalidrawElement, fallbackId: string, availableFileIds: ReadonlySet<string>): AnyElement | null {
  const type = str(raw.type, "");
  const base = baseOf(raw, fallbackId);

  if (PLAIN_SHAPE_TYPES.has(type)) return { ...base, type } as AnyElement;

  switch (type) {
    case "line":
      return { ...base, type: "line", points: relativePointsOf(raw.points) };
    case "arrow": {
      const points = relativePointsOf(raw.points);
      return {
        ...base,
        type: "arrow",
        points,
        startBinding: bindingOf(raw.startBinding),
        endBinding: bindingOf(raw.endBinding),
        startArrowhead: arrowheadOf(raw.startArrowhead),
        endArrowhead: arrowheadOf(raw.endArrowhead),
        arrowType: arrowTypeOf(raw, points.length),
      };
    }
    case "text":
      return {
        ...base,
        type: "text",
        // `originalText` is the raw string; `text` is the same string with Excalidraw's own wrap
        // breaks baked in. Deviva Draw stores only the raw form and re-derives the wrap at measure
        // time, so taking `text` when `originalText` exists would freeze a foreign layout in place.
        text: str(raw.originalText, str(raw.text, "")),
        fontFamily: fontFamilyOf(raw),
        fontSize: num(raw.fontSize, 20),
        textAlign: textAlignOf(raw),
        verticalAlign: verticalAlignOf(raw),
        lineHeight: num(raw.lineHeight, DEFAULT_TEXT_LINE_HEIGHT),
        containerId: typeof raw.containerId === "string" ? raw.containerId : null,
        fontWeight: "normal",
        fontStyle: "normal",
      };
    // `"draw"` is what freehand ink was called before Excalidraw renamed the type; libraries
    // published in that era still carry it, and it is the same element under the old name (no
    // `pressures`, so its ink is always simulated).
    case "draw":
    case "freedraw":
      return { ...base, type: "freedraw", points: freedrawPointsOf(raw.points, raw.pressures), simulatePressure: raw.simulatePressure !== false, highlighter: false };
    case "frame":
    case "magicframe":
      return { ...base, type: "frame", name: str(raw.name, "Frame") };
    case "embeddable":
    case "iframe":
      return { ...base, type: "embed", url: str(raw.link, "") };
    case "image": {
      const fileId = typeof raw.fileId === "string" ? raw.fileId : null;
      if (!fileId || !availableFileIds.has(fileId)) return null;
      // Excalidraw stores no intrinsic pixel size on the element, and decoding the bytes to find it
      // would drag a DOM dependency into the engine. The on-canvas box is the honest stand-in: it is
      // what the user last saw, so aspect-ratio-locked resizing preserves the shape they had rather
      // than snapping to some original ratio they may have deliberately changed.
      return { ...base, type: "image", fileId, naturalWidth: base.width, naturalHeight: base.height };
    }
    default:
      return null;
  }
}

/**
 * Resolves every cross-element reference against what actually survived: fills in v1's missing ref
 * `type`s, drops refs to elements that were skipped, and reconstructs v1 text-container links, which
 * that generation recorded only on the container (as a bound-element id) and never on the text.
 */
function linkElements(elements: AnyElement[]): AnyElement[] {
  const typeById = new Map(elements.map((element) => [element.id, element.type]));
  const containerByTextId = new Map<string, string>();
  for (const element of elements) {
    for (const ref of element.boundElements ?? []) {
      if (typeById.get(ref.id) === "text") containerByTextId.set(ref.id, element.id);
    }
  }

  return elements.map((element) => {
    const refs = (element.boundElements ?? [])
      .filter((ref) => typeById.has(ref.id))
      .map((ref) => ({ id: ref.id, type: ref.type || typeById.get(ref.id)! }));
    const linked = { ...element, boundElements: refs.length > 0 ? refs : null };

    if (linked.type === "text") {
      const container = linked.containerId ?? containerByTextId.get(linked.id) ?? null;
      return { ...linked, containerId: container && typeById.has(container) ? container : null } as TextElement;
    }
    if (linked.type === "arrow") {
      const keep = (binding: ArrowBinding | null) => (binding && typeById.has(binding.elementId) ? binding : null);
      return { ...linked, startBinding: keep(linked.startBinding), endBinding: keep(linked.endBinding) };
    }
    return linked;
  });
}

/** Converts one Excalidraw element array (a scene's, or one library item's). Never throws. */
export function importExcalidrawElements(raw: unknown, options: ImportExcalidrawElementsOptions = {}): ExcalidrawElementsImport {
  const skipped: Record<string, number> = {};
  if (!Array.isArray(raw)) return { elements: [], skipped };

  const availableFileIds = options.availableFileIds ?? new Set<string>();
  const elements: AnyElement[] = [];
  raw.filter(isRecord).forEach((source, index) => {
    if (source.isDeleted === true) return;
    const element = importElement(source, `imported-${index}`, availableFileIds);
    if (element) {
      elements.push(element);
      return;
    }
    const type = str(source.type, "unknown");
    skipped[type] = (skipped[type] ?? 0) + 1;
  });

  return { elements: linkElements(elements), skipped };
}
