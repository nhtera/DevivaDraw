/**
 * Per-element-type resize application: given an element and its old/new bounding box (already
 * computed by `group-transform.ts`'s `mapBoundsToGroup`, or directly from a single-element resize
 * handle drag), returns the `ElementUpdate` that actually resizes it correctly for its type — a thin
 * dispatcher over each type's own existing geometry convention, not a reimplementation of it:
 * rect/ellipse/diamond scale bounds directly; freedraw/line/arrow scale their
 * point arrays proportionally so the stored path geometry (not just its bbox) actually changes shape;
 * text scales `fontSize`; image preserves aspect ratio; bound text is skipped here entirely — its
 * container's resize triggers `text/bound-text-container-sync.ts`'s hook to re-wrap it instead, since
 * a bound text's own geometry is *derived* from its container, never resized independently).
 */
import type { AnyElement } from "../elements/element-types";
import type { ArrowElement } from "../elements/arrow-element";
import type { FreedrawElement } from "../elements/freedraw-element";
import type { LineElement } from "../elements/shape-elements";
import type { TextElement } from "../elements/text-element";
import type { ImageElement } from "../elements/image-element";
import type { SceneRect } from "../render/viewport-culling";
import type { ElementUpdate } from "../scene/scene";
import { MIN_ELEMENT_SIZE } from "./selection-geometry";

/** Floor for a scaled font size — a resize dragged small enough to zero out `fontSize` would leave unreadable/invisible text. */
const MIN_FONT_SIZE = 4;

function clampSize(bounds: SceneRect): SceneRect {
  return { ...bounds, width: Math.max(MIN_ELEMENT_SIZE, bounds.width), height: Math.max(MIN_ELEMENT_SIZE, bounds.height) };
}

function boundsScale(oldBounds: SceneRect, newBounds: SceneRect): { scaleX: number; scaleY: number } {
  return {
    scaleX: oldBounds.width === 0 ? 1 : newBounds.width / oldBounds.width,
    scaleY: oldBounds.height === 0 ? 1 : newBounds.height / oldBounds.height,
  };
}

/** Scales a line/arrow/freedraw's relative point list by `(scaleX, scaleY)` — the path's actual shape changes, not just its bbox. Non-`{x,y}` tuple fields (freedraw's pressure) pass through untouched. */
function scalePoints<P extends { x: number; y: number }>(points: readonly P[], scaleX: number, scaleY: number): P[] {
  return points.map((point) => ({ ...point, x: point.x * scaleX, y: point.y * scaleY }));
}

function resizeLineOrArrow(element: LineElement | ArrowElement, oldBounds: SceneRect, newBounds: SceneRect): ElementUpdate {
  const { scaleX, scaleY } = boundsScale(oldBounds, newBounds);
  const points = scalePoints(element.points, scaleX, scaleY);
  return { x: newBounds.x, y: newBounds.y, width: Math.max(0, newBounds.width), height: Math.max(0, newBounds.height), points } as Partial<LineElement>;
}

function resizeFreedraw(element: FreedrawElement, oldBounds: SceneRect, newBounds: SceneRect): ElementUpdate {
  const { scaleX, scaleY } = boundsScale(oldBounds, newBounds);
  const points = element.points.map(([x, y, pressure]) => [x * scaleX, y * scaleY, pressure] as const);
  return { x: newBounds.x, y: newBounds.y, width: Math.max(0, newBounds.width), height: Math.max(0, newBounds.height), points } as Partial<FreedrawElement>;
}

function resizeStandaloneText(element: TextElement, oldBounds: SceneRect, newBounds: SceneRect): ElementUpdate {
  const { scaleX, scaleY } = boundsScale(oldBounds, newBounds);
  const fontScale = Math.sqrt(Math.max(scaleX, 0) * Math.max(scaleY, 0));
  const clamped = clampSize(newBounds);
  return { ...clamped, fontSize: Math.max(MIN_FONT_SIZE, element.fontSize * fontScale) } as Partial<TextElement>;
}

/** Always preserves `naturalWidth/naturalHeight`'s aspect ratio, driven by whichever axis the handle drag changed more. */
function resizeImage(element: ImageElement, oldBounds: SceneRect, newBounds: SceneRect): ElementUpdate {
  const { scaleX, scaleY } = boundsScale(oldBounds, newBounds);
  const aspect = element.naturalWidth / Math.max(element.naturalHeight, MIN_ELEMENT_SIZE);
  const widthDriven = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1);
  const width = Math.max(MIN_ELEMENT_SIZE, widthDriven ? newBounds.width : newBounds.height * aspect);
  const height = Math.max(MIN_ELEMENT_SIZE, widthDriven ? width / aspect : newBounds.height);
  return { x: newBounds.x, y: newBounds.y, width, height };
}

/**
 * Dispatches `element`'s resize from `oldBounds` to `newBounds`. Returns `null` for a bound text
 * element (`containerId !== null`) — see the module doc — so the caller knows to skip it rather than
 * writing a no-op/wrong update.
 */
export function dispatchResize(element: AnyElement, oldBounds: SceneRect, newBounds: SceneRect): ElementUpdate | null {
  switch (element.type) {
    case "line":
    case "arrow":
      return resizeLineOrArrow(element, oldBounds, newBounds);
    case "freedraw":
      return resizeFreedraw(element, oldBounds, newBounds);
    case "text":
      return element.containerId !== null ? null : resizeStandaloneText(element, oldBounds, newBounds);
    case "image":
      return resizeImage(element, oldBounds, newBounds);
    case "rectangle":
    case "ellipse":
    case "diamond":
    case "generic":
      return clampSize(newBounds);
    default:
      return null;
  }
}
