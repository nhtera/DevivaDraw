/** Drag-to-create heart tool — see `drag-shape-tool-base.ts` for the shared gesture handling. */
import type { HeartElement } from "../elements/shape-elements";
import { createHeartElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class HeartTool extends DragShapeTool {
  protected buildElement(rect: DragRect, style: ShapeStyle): HeartElement {
    return createHeartElement({ ...rect, ...style });
  }
}
