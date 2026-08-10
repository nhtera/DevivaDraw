/** Drag-to-create hexagon tool — see `drag-shape-tool-base.ts` for the shared gesture handling. */
import type { HexagonElement } from "../elements/shape-elements";
import { createHexagonElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class HexagonTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): HexagonElement {
    return createHexagonElement({ ...rect, ...style });
  }
}
