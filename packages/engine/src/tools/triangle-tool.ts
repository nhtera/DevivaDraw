/** Drag-to-create triangle tool — see `drag-shape-tool-base.ts` for the shared gesture handling. */
import type { TriangleElement } from "../elements/shape-elements";
import { createTriangleElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class TriangleTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): TriangleElement {
    return createTriangleElement({ ...rect, ...style });
  }
}
