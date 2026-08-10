/** Drag-to-create cloud tool — see `drag-shape-tool-base.ts` for the shared gesture handling. */
import type { CloudElement } from "../elements/shape-elements";
import { createCloudElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class CloudTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): CloudElement {
    return createCloudElement({ ...rect, ...style });
  }
}
