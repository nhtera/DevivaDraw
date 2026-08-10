/**
 * `EmbedElement`: a rectangular window onto external web content (a YouTube video, a Figma file, …).
 * Stores only the original `url`; the host app decides how to render it — a live sandboxed `<iframe>`
 * overlay in the browser, and a labelled placeholder card on the canvas itself (so exports and
 * non-interactive states still show *something*). Kept a first-class element (not a special image) so
 * it moves/resizes/persists/serializes like everything else, with no binary payload.
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";

export interface EmbedElement extends BaseElement {
  type: "embed";
  url: string;
}

export interface EmbedElementCreationInput extends ElementCreationInput {
  url: string;
}

export const DEFAULT_EMBED_WIDTH = 460;
export const DEFAULT_EMBED_HEIGHT = 260;

export function createEmbedElement(input: EmbedElementCreationInput): EmbedElement {
  return {
    ...createElementBase(input),
    type: "embed",
    url: input.url,
  };
}
