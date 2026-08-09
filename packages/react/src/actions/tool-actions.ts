/**
 * Tool-switch actions — one per entry in `runtime/tool-names.ts`, each a thin `toolStateMachine.setTool`
 * call. `isEnabled` is intentionally omitted (always enabled): `ToolStateMachine.setTool` already
 * degrades gracefully (returns `false`, does nothing) when a gesture is mid-flight, so there is no
 * separate disabled-state UI needs to reflect.
 */
import type { Action } from "./action-types";
import {
  ARROW_TOOL_NAME,
  DIAMOND_TOOL_NAME,
  ELLIPSE_TOOL_NAME,
  ERASER_TOOL_NAME,
  FREEDRAW_TOOL_NAME,
  LINE_TOOL_NAME,
  PAN_TOOL_NAME,
  RECTANGLE_TOOL_NAME,
  SELECT_TOOL_NAME,
  TEXT_TOOL_NAME,
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
    toolAction("line-tool", "tool.line", "line", LINE_TOOL_NAME, "l"),
    toolAction("arrow-tool", "tool.arrow", "arrow", ARROW_TOOL_NAME, "a"),
    toolAction("freedraw-tool", "tool.freedraw", "pencil", FREEDRAW_TOOL_NAME, "p"),
    toolAction("text-tool", "tool.text", "text", TEXT_TOOL_NAME, "t"),
    toolAction("eraser-tool", "tool.eraser", "eraser", ERASER_TOOL_NAME, "e"),
  ];
}
