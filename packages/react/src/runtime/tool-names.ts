/**
 * Tool-name string constants shared across the runtime wiring, the action registry, and the toolbar —
 * `@deviva-draw/react` owns the one canonical set every consumer imports instead of each hand-typing
 * the same literal strings.
 */
export const SELECT_TOOL_NAME = "select";
export const PAN_TOOL_NAME = "pan";
export const RECTANGLE_TOOL_NAME = "rectangle";
export const ELLIPSE_TOOL_NAME = "ellipse";
export const DIAMOND_TOOL_NAME = "diamond";
export const LINE_TOOL_NAME = "line";
export const FREEDRAW_TOOL_NAME = "freedraw";
export const TEXT_TOOL_NAME = "text";
export const ARROW_TOOL_NAME = "arrow";
export const ERASER_TOOL_NAME = "eraser";
export const BUCKET_FILL_TOOL_NAME = "bucket-fill";
export const LASER_TOOL_NAME = "laser";
/** Drops a comment pin. Not in `DRAW_CAPABLE_TOOL_NAMES`: it places chrome, not content, so a finger tap should keep placing pins rather than pan. */
export const COMMENT_TOOL_NAME = "comment";
export const HIGHLIGHTER_TOOL_NAME = "highlighter";
export const TRIANGLE_TOOL_NAME = "triangle";
export const HEXAGON_TOOL_NAME = "hexagon";
export const STAR_TOOL_NAME = "star";
export const LASSO_TOOL_NAME = "lasso";
export const FRAME_TOOL_NAME = "frame";
export const NOTE_TOOL_NAME = "note";
export const TABLE_TOOL_NAME = "table";
export const CLOUD_TOOL_NAME = "cloud";
export const HEART_TOOL_NAME = "heart";
export const X_BOX_TOOL_NAME = "x-box";
export const CHECK_BOX_TOOL_NAME = "check-box";
// The four block-arrow tools all create the one `block-arrow` element type, differing only by direction.
export const BLOCK_ARROW_RIGHT_TOOL_NAME = "block-arrow-right";
export const BLOCK_ARROW_LEFT_TOOL_NAME = "block-arrow-left";
export const BLOCK_ARROW_UP_TOOL_NAME = "block-arrow-up";
export const BLOCK_ARROW_DOWN_TOOL_NAME = "block-arrow-down";

/**
 * Tools whose single-pointer gesture *creates content* — the set the pen-only-draw touch routing
 * consults: with that preference on, a single-finger touch pans the camera instead of drawing while
 * one of these is active. Deliberately excludes the tap/selection-oriented tools (select, pan,
 * lasso, eraser, bucket-fill, laser) so a finger tap keeps selecting/erasing exactly as before.
 * Lives here, next to the canonical tool-name registry, so a new tool must opt in explicitly rather
 * than the pipeline guessing from a hardcoded list. New creation tools should be added here.
 */
export const DRAW_CAPABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  RECTANGLE_TOOL_NAME,
  ELLIPSE_TOOL_NAME,
  DIAMOND_TOOL_NAME,
  TRIANGLE_TOOL_NAME,
  HEXAGON_TOOL_NAME,
  STAR_TOOL_NAME,
  CLOUD_TOOL_NAME,
  HEART_TOOL_NAME,
  X_BOX_TOOL_NAME,
  CHECK_BOX_TOOL_NAME,
  BLOCK_ARROW_RIGHT_TOOL_NAME,
  BLOCK_ARROW_LEFT_TOOL_NAME,
  BLOCK_ARROW_UP_TOOL_NAME,
  BLOCK_ARROW_DOWN_TOOL_NAME,
  LINE_TOOL_NAME,
  ARROW_TOOL_NAME,
  FREEDRAW_TOOL_NAME,
  HIGHLIGHTER_TOOL_NAME,
  TEXT_TOOL_NAME,
  FRAME_TOOL_NAME,
  NOTE_TOOL_NAME,
  TABLE_TOOL_NAME,
]);

/**
 * The pen-only-draw routing decision the engine pipeline consults per touch gesture
 * (`getTouchDrawPolicy`): pan only when the preference is on AND the active tool would otherwise
 * draw — tap-to-select and other non-creating tools keep native touch behavior.
 */
export function resolveTouchDrawPolicy(penOnlyDraw: boolean, activeToolName: string): "draw" | "pan" {
  return penOnlyDraw && DRAW_CAPABLE_TOOL_NAMES.has(activeToolName) ? "pan" : "draw";
}
