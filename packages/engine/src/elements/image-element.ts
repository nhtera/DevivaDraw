/**
 * `ImageElement`: a raster image placed on the canvas. Stores only a `fileId` reference into
 * `Scene.files` — never the pixel data itself (see `images/files-map.ts`'s module doc for why that
 * indirection matters for persistence/collab). `width`/`height` (inherited from `BaseElement`) are
 * the element's on-canvas box and are freely, independently resizable by the user; `naturalWidth`/
 * `naturalHeight` are the image's intrinsic decoded pixel dimensions, captured once at insertion time
 * (see `images/insert-image-file.ts`) and never mutated afterward. They're kept on the element
 * itself — not re-derived from the decoded bitmap on every use — so aspect-ratio-lock math (a later
 * phase's resize handles) never needs a bitmap decode just to know the original ratio, and the ratio
 * is still known even before the bitmap has actually finished decoding.
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";

/**
 * Mirroring, as `[x, y]` multipliers of `1` or `-1` — the same field, name and encoding Excalidraw
 * uses, so an imported image keeps whichever way round it was saved. A photo has no mirrored variant
 * to switch to the way a shape outline does, and rotating one by half a turn is not a mirror, so
 * flipping an image has to be recorded on the element and applied at draw time.
 *
 * Optional because scenes saved before it existed have no such field; read it through
 * `imageScaleOf`, which supplies the unmirrored default.
 */
export type ImageScale = readonly [x: number, y: number];

const UNMIRRORED: ImageScale = [1, 1];

export interface ImageElement extends BaseElement {
  type: "image";
  fileId: string;
  naturalWidth: number;
  naturalHeight: number;
  scale?: ImageScale;
}

export interface ImageElementCreationInput extends ElementCreationInput {
  fileId: string;
  naturalWidth: number;
  naturalHeight: number;
  scale?: ImageScale;
}

/** `element`'s mirroring, defaulting to unmirrored for an image stored before the field existed. */
export function imageScaleOf(element: Pick<ImageElement, "scale">): ImageScale {
  return element.scale ?? UNMIRRORED;
}

export function createImageElement(input: ImageElementCreationInput): ImageElement {
  return {
    ...createElementBase(input),
    type: "image",
    fileId: input.fileId,
    naturalWidth: input.naturalWidth,
    naturalHeight: input.naturalHeight,
    scale: input.scale ?? UNMIRRORED,
  };
}
