/** Drag-to-create star tool — see `drag-shape-tool-base.ts` for the shared gesture handling. */
import type { StarElement } from "../elements/shape-elements";
import { createStarElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class StarTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): StarElement {
    return createStarElement({ ...rect, ...style });
  }
}
