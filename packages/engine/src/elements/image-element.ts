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
import type { MirrorScale } from "./element-mirror";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";

/** Source-rect crop as fractions of the natural image (`x`/`y` top-left, all in [0, 1]) — the element box shows only this window. Absent/`null` ⇒ the whole image. */
export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageElement extends BaseElement {
  type: "image";
  fileId: string;
  naturalWidth: number;
  naturalHeight: number;
  crop?: ImageCrop | null;
}

export interface ImageElementCreationInput extends ElementCreationInput {
  fileId: string;
  naturalWidth: number;
  naturalHeight: number;
  scale?: MirrorScale;
}

export function createImageElement(input: ImageElementCreationInput): ImageElement {
  return {
    ...createElementBase(input),
    type: "image",
    fileId: input.fileId,
    naturalWidth: input.naturalWidth,
    naturalHeight: input.naturalHeight,
  };
}
