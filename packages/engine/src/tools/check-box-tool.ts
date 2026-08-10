/** Drag-to-create check-box tool (a box with a checkmark) — see `drag-shape-tool-base.ts`. */
import type { CheckBoxElement } from "../elements/shape-elements";
import { createCheckBoxElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class CheckBoxTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): CheckBoxElement {
    return createCheckBoxElement({ ...rect, ...style });
  }
}
