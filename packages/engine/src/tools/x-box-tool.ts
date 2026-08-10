/** Drag-to-create x-box tool (a box with an X through it) — see `drag-shape-tool-base.ts`. */
import type { XBoxElement } from "../elements/shape-elements";
import { createXBoxElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class XBoxTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): XBoxElement {
    return createXBoxElement({ ...rect, ...style });
  }
}
