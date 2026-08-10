/**
 * `FreedrawElement`: a pressure-sensitive ink stroke drawn with the freehand tool
 * (`tools/freedraw-tool.ts`). Stores the raw pointer samples captured during the gesture, not the
 * rendered outline — perfect-freehand's outline polygon (`render/freedraw-renderer.ts`) is derived
 * from these points at render time, so a later stroke-width/style change (or an algorithm tweak)
 * never needs to touch already-captured input data, only re-run the derivation.
 *
 * `fillStyle`/`backgroundColor`/`roughness` are inherited from `BaseElement` but unused: freedraw
 * ink has no fill and never goes through the rough.js sketchy renderer (see
 * `render/rough-renderer.ts`'s module doc) — kept on the type only because every element shares one
 * `BaseElement` shape, not because freedraw reads them.
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";

/** One captured sample: position relative to the owning element's `(x, y)` origin, plus pressure in `[0, 1]`. */
export type FreedrawPoint = readonly [x: number, y: number, pressure: number];

export interface FreedrawElement extends BaseElement {
  type: "freedraw";
  /** Vertices in draw order, relative to `(x, y)` — at least one for a committed element. */
  points: readonly FreedrawPoint[];
  /**
   * Whether perfect-freehand should ignore each point's recorded pressure and infer stroke width
   * from movement speed instead. Decided once, at capture time, from the originating pointer's
   * type (`true` for mouse/touch, which never report a genuine pressure signal; `false` for a
   * pressure-capable pen/stylus) — persisted on the element rather than re-derived at render time,
   * so recomputing the outline later (e.g. after a stroke-width change) reproduces the same look
   * the user actually drew instead of re-guessing the input device.
   */
  simulatePressure: boolean;
  /**
   * Whether this stroke is a *highlighter* mark rather than plain ink: rendered with a constant thick
   * nib (no pressure taper), translucent, and `multiply` compositing so it darkens whatever it crosses
   * without hiding it — the marker affordance tldraw exposes. Stored on the element (not inferred from
   * the tool) so the renderer draws it correctly regardless of which tool produced it.
   */
  highlighter: boolean;
}

export interface FreedrawElementCreationInput extends ElementCreationInput {
  points: readonly FreedrawPoint[];
  /** Defaults to `true` (simulate) — the safer default for callers that don't know their input device. */
  simulatePressure?: boolean;
  /** Defaults to `false` (plain ink) — see `FreedrawElement.highlighter`. */
  highlighter?: boolean;
}

export function createFreedrawElement(input: FreedrawElementCreationInput): FreedrawElement {
  return {
    ...createElementBase(input),
    type: "freedraw",
    points: input.points,
    simulatePressure: input.simulatePressure ?? true,
    highlighter: input.highlighter ?? false,
  };
}
