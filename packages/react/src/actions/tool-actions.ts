/**
 * Tool-switch actions — one per entry in `runtime/tool-names.ts`, each a thin `toolStateMachine.setTool`
 * call. `isEnabled` is intentionally omitted (always enabled): `ToolStateMachine.setTool` already
 * degrades gracefully (returns `false`, does nothing) when a gesture is mid-flight, so there is no
 * separate disabled-state UI needs to reflect.
 */
import type { Action } from "./action-types";
import {
  ARROW_TOOL_NAME,
  BLOCK_ARROW_DOWN_TOOL_NAME,
  BLOCK_ARROW_LEFT_TOOL_NAME,
  BLOCK_ARROW_RIGHT_TOOL_NAME,
  BLOCK_ARROW_UP_TOOL_NAME,
  BUCKET_FILL_TOOL_NAME,
  CHECK_BOX_TOOL_NAME,
  CLOUD_TOOL_NAME,
  DIAMOND_TOOL_NAME,
  ELLIPSE_TOOL_NAME,
  ERASER_TOOL_NAME,
  FRAME_TOOL_NAME,
  FREEDRAW_TOOL_NAME,
  HEART_TOOL_NAME,
  HEXAGON_TOOL_NAME,
  HIGHLIGHTER_TOOL_NAME,
  LASER_TOOL_NAME,
  LASSO_TOOL_NAME,
  LINE_TOOL_NAME,
  NOTE_TOOL_NAME,
  PAN_TOOL_NAME,
  RECTANGLE_TOOL_NAME,
  SELECT_TOOL_NAME,
  STAR_TOOL_NAME,
  TEXT_TOOL_NAME,
  TRIANGLE_TOOL_NAME,
  X_BOX_TOOL_NAME,
} from "../runtime/tool-names";

function toolAction(id: string, labelKey: Action["labelKey"], icon: string, toolName: string, shortcut?: string): Action {
  return { id, labelKey, icon, shortcut, run: (runtime) => void runtime.toolStateMachine.setTool(toolName) };
}

export function buildToolActions(): Action[] {
  return [
    toolAction("select-tool", "tool.select", "cursor", SELECT_TOOL_NAME, "1"),
    toolAction("pan-tool", "tool.pan", "hand", PAN_TOOL_NAME, "h"),
    toolAction("rectangle-tool", "tool.rectangle", "rectangle", RECTANGLE_TOOL_NAME, "r"),
    toolAction("ellipse-tool", "tool.ellipse", "ellipse", ELLIPSE_TOOL_NAME, "o"),
    toolAction("diamond-tool", "tool.diamond", "diamond", DIAMOND_TOOL_NAME, "d"),
    toolAction("triangle-tool", "tool.triangle", "triangle", TRIANGLE_TOOL_NAME),
    toolAction("hexagon-tool", "tool.hexagon", "hexagon", HEXAGON_TOOL_NAME),
    toolAction("star-tool", "tool.star", "star", STAR_TOOL_NAME),
    toolAction("cloud-tool", "tool.cloud", "cloud", CLOUD_TOOL_NAME),
    toolAction("heart-tool", "tool.heart", "heart", HEART_TOOL_NAME),
    toolAction("x-box-tool", "tool.xbox", "x-box", X_BOX_TOOL_NAME),
    toolAction("check-box-tool", "tool.checkbox", "check-box", CHECK_BOX_TOOL_NAME),
    toolAction("block-arrow-right-tool", "tool.blockArrowRight", "block-arrow-right", BLOCK_ARROW_RIGHT_TOOL_NAME),
    toolAction("block-arrow-left-tool", "tool.blockArrowLeft", "block-arrow-left", BLOCK_ARROW_LEFT_TOOL_NAME),
    toolAction("block-arrow-up-tool", "tool.blockArrowUp", "block-arrow-up", BLOCK_ARROW_UP_TOOL_NAME),
    toolAction("block-arrow-down-tool", "tool.blockArrowDown", "block-arrow-down", BLOCK_ARROW_DOWN_TOOL_NAME),
    toolAction("note-tool", "tool.note", "note", NOTE_TOOL_NAME, "n"),
    toolAction("line-tool", "tool.line", "line", LINE_TOOL_NAME, "l"),
    toolAction("arrow-tool", "tool.arrow", "arrow", ARROW_TOOL_NAME, "a"),
    toolAction("freedraw-tool", "tool.freedraw", "pencil", FREEDRAW_TOOL_NAME, "p"),
    toolAction("highlighter-tool", "tool.highlighter", "highlighter", HIGHLIGHTER_TOOL_NAME),
    toolAction("text-tool", "tool.text", "text", TEXT_TOOL_NAME, "t"),
    toolAction("eraser-tool", "tool.eraser", "eraser", ERASER_TOOL_NAME, "e"),
    toolAction("bucket-fill-tool", "tool.bucketFill", "bucket", BUCKET_FILL_TOOL_NAME, "b"),
    toolAction("laser-tool", "tool.laser", "laser", LASER_TOOL_NAME, "k"),
    toolAction("lasso-tool", "tool.lasso", "lasso", LASSO_TOOL_NAME),
    toolAction("frame-tool", "tool.frame", "frame", FRAME_TOOL_NAME, "f"),
  ];
}
