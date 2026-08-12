/**
 * Which axes each bounding-box shape's *outline* is mirror-symmetric about. Only one thing needs this:
 * flipping a selection (`selection/flip-selection.ts`). A shape stores no mirrored variant of its
 * outline — the renderer derives it from the type alone — so a flip can only mirror a shape whose
 * outline already answers to that mirror, or turn it by half a turn when a mirror happens to equal a
 * 180° rotation for that shape.
 *
 * The values are read off the geometry each shape is actually drawn from: polygon outlines from
 * `polygon-shape-geometry.ts`'s unit vertices, curved ones from `render/rough-shape-geometry.ts`'s
 * paths. Content-bearing types (text, image, embed) are absent on purpose — their appearance has
 * nothing to do with a shape outline, and they are never rotated to fake a mirror.
 */

/** `vertical`: mirroring left↔right leaves the outline unchanged. `horizontal`: mirroring top↔bottom does. */
export interface OutlineSymmetry {
  vertical: boolean;
  horizontal: boolean;
}

const SYMMETRIC_BOTH: OutlineSymmetry = { vertical: true, horizontal: true };
/** Unchanged by a left↔right mirror, but not by a top↔bottom one — so flipping one vertically *is* a half turn. */
const SYMMETRIC_VERTICAL_ONLY: OutlineSymmetry = { vertical: true, horizontal: false };
/** Symmetric about neither axis: no rotation reproduces either mirror, so these outlines only ever move. */
const SYMMETRIC_NEITHER: OutlineSymmetry = { vertical: false, horizontal: false };

const OUTLINE_SYMMETRY: Readonly<Record<string, OutlineSymmetry>> = {
  rectangle: SYMMETRIC_BOTH,
  generic: SYMMETRIC_BOTH,
  note: SYMMETRIC_BOTH,
  frame: SYMMETRIC_BOTH,
  ellipse: SYMMETRIC_BOTH,
  "double-circle": SYMMETRIC_BOTH,
  diamond: SYMMETRIC_BOTH,
  hexagon: SYMMETRIC_BOTH,
  "x-box": SYMMETRIC_BOTH,

  triangle: SYMMETRIC_VERTICAL_ONLY, // apex at the top
  star: SYMMETRIC_VERTICAL_ONLY, // a point at the top, two at the bottom
  trapezoid: SYMMETRIC_VERTICAL_ONLY, // narrow top, wide base
  heart: SYMMETRIC_VERTICAL_ONLY, // lobes at the top, point at the bottom
  cylinder: SYMMETRIC_VERTICAL_ONLY, // cap on top, base below

  cloud: SYMMETRIC_NEITHER, // hand-placed bumps, no matching pair on either axis
  "check-box": SYMMETRIC_NEITHER, // the tick runs low-left to high-right
  parallelogram: SYMMETRIC_NEITHER, // its mirror is the opposite lean, which is a different outline
};

/**
 * `type`'s outline symmetry, defaulting to "symmetric about neither" for anything not listed —
 * unknown outlines are left alone rather than speculatively rotated.
 */
export function shapeOutlineSymmetry(type: string): OutlineSymmetry {
  return OUTLINE_SYMMETRY[type] ?? SYMMETRIC_NEITHER;
}
