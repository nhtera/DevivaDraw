/**
 * Interactive layer: the overlay canvas stacked on top of the static one (see `canvas-stage.ts`'s
 * DOM append order), repainted every frame a gesture might be touching — selection outline, the 8
 * resize handles + rotate handle, the rubber-band marquee rectangle, and object-snap alignment
 * guides. All of this is transient UI chrome derived from `selection/`'s pure geometry
 * (`selection-tool-frame.ts`'s `buildSelectionFrame`, `resize-handles.ts`'s handle positions) — this
 * layer never touches `Scene` or history, only reads already-resolved elements/state the host passes
 * in via `OverlayState` each frame.
 */
import type { AnyElement } from "../elements/element-types";
import { handlePositions, rotateHandlePosition, RESIZE_HANDLE_IDS } from "../selection/resize-handles";
import { rotatePointAroundCenter } from "../selection/selection-geometry";
import { buildSelectionFrame } from "../selection/selection-tool-frame";
import type { SelectionFrame } from "../selection/selection-tool-frame";
import type { SnapGuide } from "../selection/snapping";
import type { Camera, Point } from "./camera";
import { sceneToScreen } from "./camera";
import type { SceneRect } from "./viewport-culling";

/** Minimal 2D-context surface this layer needs; a real `CanvasRenderingContext2D` satisfies it. */
export interface InteractiveLayerContext {
  readonly canvas: { clientWidth: number; clientHeight: number };
  clearRect(x: number, y: number, width: number, height: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  fill(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  setLineDash(segments: number[]): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
}

export interface OverlayState {
  /** Already-resolved (id -> element) current selection — the host owns that lookup, this layer only draws. */
  selectedElements: readonly AnyElement[];
  /** Live rubber-band drag rect (scene space), or `null` outside a marquee gesture. */
  marqueeRect: SceneRect | null;
  /** Live object-snap alignment guides (scene space), or `[]` outside a snapping move. */
  snapGuides: readonly SnapGuide[];
}

const SELECTION_COLOR = "#1971c2";
const HANDLE_SIZE_PX = 8;
const ROTATE_HANDLE_OFFSET_PX = 28;
const SNAP_GUIDE_COLOR = "#e64980";
const MARQUEE_FILL = "rgba(25, 113, 194, 0.08)";

/** Local-space rect corners rotated by `frame.angle` around `frame.pivot`, in scene space. */
function frameOutlineScene(frame: SelectionFrame): Point[] {
  const { x, y, width, height } = frame.bounds;
  const corners: Point[] = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  return corners.map((corner) => rotatePointAroundCenter(corner, frame.pivot, frame.angle));
}

export class InteractiveLayer {
  private readonly ctx: InteractiveLayerContext;

  constructor(ctx: InteractiveLayerContext) {
    this.ctx = ctx;
  }

  render(overlayState: OverlayState, camera: Camera): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.clientWidth, this.ctx.canvas.clientHeight);
    this.drawMarquee(overlayState.marqueeRect, camera);
    this.drawSnapGuides(overlayState.snapGuides, camera);

    const frame = buildSelectionFrame(overlayState.selectedElements);
    if (frame) this.drawSelectionFrame(frame, camera);
  }

  private drawMarquee(rect: SceneRect | null, camera: Camera): void {
    if (!rect) return;
    const topLeft = sceneToScreen({ x: rect.x, y: rect.y }, camera);
    const bottomRight = sceneToScreen({ x: rect.x + rect.width, y: rect.y + rect.height }, camera);
    this.ctx.save();
    this.ctx.fillStyle = MARQUEE_FILL;
    this.ctx.strokeStyle = SELECTION_COLOR;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([]);
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;
    this.ctx.fillRect(topLeft.x, topLeft.y, width, height);
    this.ctx.strokeRect(topLeft.x, topLeft.y, width, height);
    this.ctx.restore();
  }

  private drawSnapGuides(guides: readonly SnapGuide[], camera: Camera): void {
    if (guides.length === 0) return;
    this.ctx.save();
    this.ctx.strokeStyle = SNAP_GUIDE_COLOR;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 4]);
    for (const guide of guides) {
      const from =
        guide.orientation === "vertical" ? sceneToScreen({ x: guide.position, y: guide.from }, camera) : sceneToScreen({ x: guide.from, y: guide.position }, camera);
      const to =
        guide.orientation === "vertical" ? sceneToScreen({ x: guide.position, y: guide.to }, camera) : sceneToScreen({ x: guide.to, y: guide.position }, camera);
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      this.ctx.lineTo(to.x, to.y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawSelectionFrame(frame: SelectionFrame, camera: Camera): void {
    const outline = frameOutlineScene(frame).map((point) => sceneToScreen(point, camera));
    this.ctx.save();
    this.ctx.strokeStyle = SELECTION_COLOR;
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.moveTo(outline[0]!.x, outline[0]!.y);
    for (const point of outline.slice(1)) this.ctx.lineTo(point.x, point.y);
    this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.restore();

    this.drawHandles(frame, camera);
  }

  private drawHandles(frame: SelectionFrame, camera: Camera): void {
    const toScreen = (local: Point) => sceneToScreen(rotatePointAroundCenter(local, frame.pivot, frame.angle), camera);
    const topCenterScreen = toScreen({ x: frame.bounds.x + frame.bounds.width / 2, y: frame.bounds.y });
    const rotateScreen = toScreen(rotateHandlePosition(frame.bounds, ROTATE_HANDLE_OFFSET_PX));

    this.ctx.save();
    this.ctx.strokeStyle = SELECTION_COLOR;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([]);

    this.ctx.beginPath();
    this.ctx.moveTo(topCenterScreen.x, topCenterScreen.y);
    this.ctx.lineTo(rotateScreen.x, rotateScreen.y);
    this.ctx.stroke();
    this.drawHandleSquare(rotateScreen);

    const handles = handlePositions(frame.bounds);
    for (const id of RESIZE_HANDLE_IDS) this.drawHandleSquare(toScreen(handles[id]));
    this.ctx.restore();
  }

  private drawHandleSquare(center: Point): void {
    const half = HANDLE_SIZE_PX / 2;
    this.ctx.fillRect(center.x - half, center.y - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
    this.ctx.strokeRect(center.x - half, center.y - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
  }
}
