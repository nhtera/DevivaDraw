/** Drag-to-create diamond tool — see `drag-shape-tool-base.ts` for the shared gesture handling. */
import type { DiamondElement } from "../elements/shape-elements";
import { createDiamondElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class DiamondTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): DiamondElement {
    return createDiamondElement({ ...rect, ...style });
  }
}
