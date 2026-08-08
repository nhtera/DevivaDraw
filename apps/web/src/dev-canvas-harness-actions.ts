/**
 * Builds the `action name -> handler` map `PointerEventPipeline` resolves shortcuts/toolbar actions
 * against (tool switches + zoom step/fit) — split out of `dev-canvas-harness-runtime.ts` purely to
 * keep that file under the house line-count limit.
 */
import type { PanZoomTool, ToolStateMachine } from "@deviva-draw/engine";
import {
  ARROW_TOOL_NAME,
  DIAMOND_TOOL_NAME,
  ELLIPSE_TOOL_NAME,
  FREEDRAW_TOOL_NAME,
  LINE_TOOL_NAME,
  PAN_TOOL_NAME,
  RECTANGLE_TOOL_NAME,
  SELECT_TOOL_NAME,
  TEXT_TOOL_NAME,
} from "./dev-canvas-harness-tool-names";

export function buildToolActionHandlers(toolStateMachine: ToolStateMachine, panZoomTool: PanZoomTool): Record<string, () => void> {
  return {
    "select-tool": () => toolStateMachine.setTool(SELECT_TOOL_NAME),
    "pan-tool": () => toolStateMachine.setTool(PAN_TOOL_NAME),
    "rectangle-tool": () => toolStateMachine.setTool(RECTANGLE_TOOL_NAME),
    "ellipse-tool": () => toolStateMachine.setTool(ELLIPSE_TOOL_NAME),
    "diamond-tool": () => toolStateMachine.setTool(DIAMOND_TOOL_NAME),
    "line-tool": () => toolStateMachine.setTool(LINE_TOOL_NAME),
    "freedraw-tool": () => toolStateMachine.setTool(FREEDRAW_TOOL_NAME),
    "text-tool": () => toolStateMachine.setTool(TEXT_TOOL_NAME),
    "arrow-tool": () => toolStateMachine.setTool(ARROW_TOOL_NAME),
    "zoom-in": () => panZoomTool.zoomStep(1),
    "zoom-out": () => panZoomTool.zoomStep(-1),
    "zoom-to-fit": () => panZoomTool.zoomToFit(),
  };
}
