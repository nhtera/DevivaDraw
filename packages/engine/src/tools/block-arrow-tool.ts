/**
 * Drag-to-create block-arrow tool — one class parameterized by `direction`, so the four directional
 * arrow tools are four instances of this rather than four near-identical subclasses. See
 * `drag-shape-tool-base.ts` for the shared gesture handling.
 */
import type { BlockArrowDirection, BlockArrowElement } from "../elements/shape-elements";
import { createBlockArrowElement } from "../elements/shape-elements";
import { DragShapeTool } from "./drag-shape-tool-base";
import type { DragShapeToolDeps } from "./drag-shape-tool-base";
import type { DragRect } from "./shape-drag-geometry";
import type { ShapeStyle } from "./shape-style-state";

export class BlockArrowTool extends DragShapeTool {
  private readonly direction: BlockArrowDirection;

  constructor(deps: DragShapeToolDeps, direction: BlockArrowDirection) {
    super(deps);
    this.direction = direction;
  }

  protected buildElement(rect: DragRect, style: ShapeStyle): BlockArrowElement {
    return createBlockArrowElement({ ...rect, ...style, direction: this.direction });
  }
}
