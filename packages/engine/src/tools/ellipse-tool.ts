/** Drag-to-create ellipse tool — see `drag-shape-tool-base.ts` for the shared gesture handling. */
import type { EllipseElement } from "../elements/shape-elements";
import { createEllipseElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class EllipseTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): EllipseElement {
    return createEllipseElement({ ...rect, ...style });
  }
}
