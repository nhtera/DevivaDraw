/**
 * Turns a validated `CreateElementInput` into a live scene element through the engine's PUBLIC
 * per-type factories + `Scene.addElement` — never hand-built element literals — so versioning,
 * fractional-index, and collab invariants hold for every agent-created element exactly as they do
 * for user-drawn ones. Labels reuse the engine's bound-text flow (`getOrCreateBoundText` +
 * `growContainerToFitText`), making an agent's labeled rectangle indistinguishable from a
 * double-click-typed one in the web app.
 */
import {
  createArrowElement,
  createDiamondElement,
  createEllipseElement,
  createFrameElement,
  createFreedrawElement,
  createLineElement,
  createNoteElement,
  createRectangleElement,
  createTextElement,
  DEFAULT_NOTE_BACKGROUND,
  getOrCreateBoundText,
  growContainerToFitText,
  measureWrappedText,
  buildFontCssString,
  TEXT_FONT_FAMILY_CSS,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
} from "@deviva-draw/engine";
import type { AnyElement, ElementCreationInput, FreedrawPoint, RelativePoint, Scene, TextMeasurer } from "@deviva-draw/engine";
import type { CreateElementInput } from "./element-schemas";

/** Default footprint for a box shape created without explicit size — large enough to hold a short label. */
const DEFAULT_BOX_WIDTH = 160;
const DEFAULT_BOX_HEIGHT = 90;
const DEFAULT_NOTE_SIZE = 180;
const DEFAULT_FRAME_WIDTH = 400;
const DEFAULT_FRAME_HEIGHT = 300;
const FREEDRAW_DEFAULT_PRESSURE = 0.5;

/** The `BaseElement` style/orientation fields shared by every creation variant, only-when-provided. */
function styleFields(input: CreateElementInput): Partial<ElementCreationInput> {
  const style: Partial<ElementCreationInput> = {};
  if (input.strokeColor !== undefined) style.strokeColor = input.strokeColor;
  if (input.backgroundColor !== undefined) style.backgroundColor = input.backgroundColor;
  if (input.fillStyle !== undefined) style.fillStyle = input.fillStyle;
  if (input.strokeWidth !== undefined) style.strokeWidth = input.strokeWidth;
  if (input.strokeStyle !== undefined) style.strokeStyle = input.strokeStyle;
  if (input.roughness !== undefined) style.roughness = input.roughness;
  if (input.opacity !== undefined) style.opacity = input.opacity;
  if (input.angle !== undefined) style.angle = input.angle;
  if (input.locked !== undefined) style.locked = input.locked;
  return style;
}

export interface NormalizedPoints {
  /** Offset to add to the element's (x, y) so the normalized points start at a (0, 0) minimum. */
  dx: number;
  dy: number;
  points: RelativePoint[];
  width: number;
  height: number;
}

/**
 * Shifts a vertex list so its bounding-box minimum sits at (0, 0) — the convention every engine
 * drawing tool produces — and derives the element's width/height from the same box. Agents often
 * pass points centered on their origin; normalizing here keeps `x/y/width/height` consistent with
 * the geometry for hit-testing, export bounds, and selection.
 */
export function normalizePoints(rawPoints: readonly { x: number; y: number }[]): NormalizedPoints {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of rawPoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    dx: minX,
    dy: minY,
    points: rawPoints.map((point) => ({ x: point.x - minX, y: point.y - minY })),
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Natural (unwrapped) block size of standalone text under the session measurer — explicit `\n` only. */
export function measureStandaloneText(text: string, fontSize: number, fontFamily: "hand-drawn-slot" | "normal" | "code", measurer: TextMeasurer): { width: number; height: number } {
  const metrics = measureWrappedText(text, {
    measurer,
    fontCss: buildFontCssString(fontSize, TEXT_FONT_FAMILY_CSS[fontFamily]),
    fontSizePx: fontSize,
    lineHeightMultiplier: DEFAULT_TEXT_LINE_HEIGHT,
    maxWidth: Infinity,
  });
  return { width: metrics.widthPx, height: metrics.totalHeightPx };
}

function buildElement(input: CreateElementInput, measurer: TextMeasurer): AnyElement {
  const style = styleFields(input);
  switch (input.type) {
    case "rectangle":
      return createRectangleElement({ ...style, x: input.x, y: input.y, width: input.width ?? DEFAULT_BOX_WIDTH, height: input.height ?? DEFAULT_BOX_HEIGHT });
    case "ellipse":
      return createEllipseElement({ ...style, x: input.x, y: input.y, width: input.width ?? DEFAULT_BOX_WIDTH, height: input.height ?? DEFAULT_BOX_HEIGHT });
    case "diamond":
      return createDiamondElement({ ...style, x: input.x, y: input.y, width: input.width ?? DEFAULT_BOX_WIDTH, height: input.height ?? DEFAULT_BOX_HEIGHT });
    case "note":
      return createNoteElement({
        backgroundColor: DEFAULT_NOTE_BACKGROUND,
        fillStyle: "solid",
        ...style,
        x: input.x,
        y: input.y,
        width: input.width ?? DEFAULT_NOTE_SIZE,
        height: input.height ?? DEFAULT_NOTE_SIZE,
      });
    case "frame":
      return createFrameElement({ ...style, x: input.x, y: input.y, width: input.width ?? DEFAULT_FRAME_WIDTH, height: input.height ?? DEFAULT_FRAME_HEIGHT, name: input.name });
    case "line": {
      const normalized = normalizePoints(input.points);
      return createLineElement({ ...style, x: input.x + normalized.dx, y: input.y + normalized.dy, width: normalized.width, height: normalized.height, points: normalized.points });
    }
    case "arrow": {
      const normalized = normalizePoints(input.points);
      return createArrowElement({
        ...style,
        x: input.x + normalized.dx,
        y: input.y + normalized.dy,
        width: normalized.width,
        height: normalized.height,
        points: normalized.points,
        startArrowhead: input.startArrowhead,
        endArrowhead: input.endArrowhead,
        arrowType: input.arrowType,
      });
    }
    case "text": {
      const fontSize = input.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
      const fontFamily = input.fontFamily ?? "hand-drawn-slot";
      const size = measureStandaloneText(input.text, fontSize, fontFamily, measurer);
      return createTextElement({ ...style, x: input.x, y: input.y, width: size.width, height: size.height, text: input.text, fontSize, fontFamily, textAlign: input.textAlign });
    }
    case "freedraw": {
      const normalized = normalizePoints(input.points);
      const inkPoints: FreedrawPoint[] = normalized.points.map((point) => [point.x, point.y, FREEDRAW_DEFAULT_PRESSURE]);
      return createFreedrawElement({ ...style, x: input.x + normalized.dx, y: input.y + normalized.dy, width: normalized.width, height: normalized.height, points: inkPoints });
    }
  }
}

/** Sets (or replaces) a bindable container's label through the engine's own bound-text flow. */
export function applyLabel(scene: Scene, containerId: string, label: string, measurer: TextMeasurer): void {
  getOrCreateBoundText(scene, containerId);
  growContainerToFitText(scene, containerId, label, measurer);
}

/** Builds + inserts one element (and its label, when given), returning the element's stored state. */
export function insertElementFromInput(scene: Scene, input: CreateElementInput, measurer: TextMeasurer): AnyElement {
  const stored = scene.addElement(buildElement(input, measurer));
  if ((input.type === "rectangle" || input.type === "ellipse" || input.type === "diamond" || input.type === "note") && input.label !== undefined && input.label.length > 0) {
    applyLabel(scene, stored.id, input.label, measurer);
  }
  // Re-read: the label grow pass may have updated the container's height after insertion.
  return scene.getElement(stored.id) ?? stored;
}
