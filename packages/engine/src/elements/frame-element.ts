/**
 * `FrameElement`: a named rectangular region that groups the elements inside it (see
 * `selection/frame-membership.ts`) — dragging the frame moves its contents with it, the organizing
 * primitive both tldraw and Excalidraw expose. Rendered as a thin border plus a name label above the
 * top edge (`render/frame-renderer.ts`); its interior is deliberately transparent (and not a
 * pointer-hit target) so the elements it holds stay visible and clickable — you grab a frame by its
 * border or header, not by clicking through its middle.
 *
 * Style fields inherited from `BaseElement` (fill/roughness/roundness/etc.) are unused: a frame's
 * appearance is fixed chrome, not user-styled — kept on the type only because every element shares one
 * `BaseElement` shape.
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";

export interface FrameElement extends BaseElement {
  type: "frame";
  /** The frame's display name, shown in its header label (e.g. `"Frame 1"`). */
  name: string;
}

export interface FrameElementCreationInput extends ElementCreationInput {
  /** Defaults to `"Frame"` when omitted — callers that number frames pass e.g. `"Frame 3"`. */
  name?: string;
}

export function createFrameElement(input: FrameElementCreationInput): FrameElement {
  return { ...createElementBase(input), type: "frame", name: input.name ?? "Frame" };
}
