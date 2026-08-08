/** Drag-to-create rectangle tool — see `drag-shape-tool-base.ts` for the shared gesture handling. */
import type { RectangleElement } from "../elements/shape-elements";
import { createRectangleElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class RectangleTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): RectangleElement {
    return createRectangleElement({ ...rect, ...style });
  }
}
