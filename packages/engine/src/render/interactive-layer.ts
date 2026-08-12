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
import { handlePositions, inflateSelectionBounds, rotateHandlePosition, RESIZE_HANDLE_IDS } from "../selection/resize-handles";
import { rotatePointAroundCenter } from "../selection/selection-geometry";
import { buildSelectionFrame } from "../selection/selection-tool-frame";
import type { SelectionFrame } from "../selection/selection-tool-frame";
import type { SnapGuide } from "../selection/snapping";
import type { LaserTrailPoint } from "../tools/laser-tool";
import type { Camera, Point } from "./camera";
import { sceneToScreen } from "./camera";
import type { SceneRect } from "./viewport-culling";

/**
 * Minimal 2D-context surface this layer needs; a real `CanvasRenderingContext2D` satisfies it.
 * `fillText`/`font` are optional (unlike every other member here): they're only reached by remote-cursor
 * name labels (see `drawRemoteCursors`), so a caller that never wires collaboration (most tests, and any
 * embedder that doesn't pass `remoteCursors`) never needs to implement them on a fake context.
 */
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
  fillText?(text: string, x: number, y: number): void;
  font?: string;
}

/** A collaborator's live cursor, already resolved to scene coordinates — the host (`packages/react`'s render loop) owns turning `@deviva-draw/collab-client` presence data into this shape each frame. */
export interface RemoteCursorOverlay {
  id: string;
  name: string;
  color: string;
  point: Point;
}

export interface OverlayState {
  /** Already-resolved (id -> element) current selection — the host owns that lookup, this layer only draws. */
  selectedElements: readonly AnyElement[];
  /** Live rubber-band drag rect (scene space), or `null` outside a marquee gesture. */
  marqueeRect: SceneRect | null;
  /** Live object-snap alignment guides (scene space), or `[]` outside a snapping move. */
  snapGuides: readonly SnapGuide[];
  /** Other collaborators' live cursors — optional and defaults to none drawn, so every non-collab host/test stays unaffected. */
  remoteCursors?: readonly RemoteCursorOverlay[];
  /** Laser-pointer trail (scene space, oldest→newest, each with its fade opacity), or `[]`/omitted when the laser isn't in use — see `tools/laser-tool.ts`. */
  laserTrail?: readonly LaserTrailPoint[];
  /** Live free-form lasso-selection loop (scene space), or `[]`/omitted outside a lasso drag — see `tools/lasso-tool.ts`. */
  lassoPath?: readonly Point[];
}

const SELECTION_COLOR = "#1971c2";
const HANDLE_SIZE_PX = 8;
const ROTATE_HANDLE_OFFSET_PX = 28;
const SNAP_GUIDE_COLOR = "#e64980";
const MARQUEE_FILL = "rgba(25, 113, 194, 0.08)";
const REMOTE_CURSOR_SIZE_PX = 12;
const LASER_COLOR_RGB = "255, 45, 45";
const LASER_WIDTH_PX = 4;

/** `bounds`' corners rotated by `frame.angle` around `frame.pivot`, in scene space. Takes `bounds` separately from `frame` so the caller can pass the padded rect it paints. */
function frameOutlineScene(frame: SelectionFrame, bounds: SceneRect): Point[] {
  const { x, y, width, height } = bounds;
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
    this.drawLasso(overlayState.lassoPath ?? [], camera);
    this.drawSnapGuides(overlayState.snapGuides, camera);

    const frame = buildSelectionFrame(overlayState.selectedElements);
    if (frame) this.drawSelectionFrame(frame, camera);

    this.drawRemoteCursors(overlayState.remoteCursors ?? [], camera);
    this.drawLaserTrail(overlayState.laserTrail ?? [], camera);
  }

  /**
   * The laser trail as a chain of round-capped segments, each drawn at the fade opacity of its newer
   * endpoint so the tail dissolves oldest-first. Opacity rides in the `rgba()` stroke color (this
   * layer's context has no `globalAlpha`), and a solid dot marks the head (the current pointer spot).
   */
  private drawLaserTrail(trail: readonly LaserTrailPoint[], camera: Camera): void {
    if (trail.length === 0) return;
    this.ctx.save();
    this.ctx.setLineDash([]);
    this.ctx.lineWidth = LASER_WIDTH_PX;
    for (let i = 1; i < trail.length; i += 1) {
      const from = sceneToScreen(trail[i - 1]!, camera);
      const to = sceneToScreen(trail[i]!, camera);
      this.ctx.strokeStyle = `rgba(${LASER_COLOR_RGB}, ${trail[i]!.opacity})`;
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      this.ctx.lineTo(to.x, to.y);
      this.ctx.stroke();
    }
    const head = trail[trail.length - 1]!;
    const headScreen = sceneToScreen(head, camera);
    this.ctx.fillStyle = `rgba(${LASER_COLOR_RGB}, ${head.opacity})`;
    this.ctx.beginPath();
    // A small round head; `arc` isn't in the minimal context surface, so approximate with a filled square-ish dot via fillRect.
    this.ctx.fillRect(headScreen.x - LASER_WIDTH_PX / 2, headScreen.y - LASER_WIDTH_PX / 2, LASER_WIDTH_PX, LASER_WIDTH_PX);
    this.ctx.restore();
  }

  /** Each cursor is a small filled triangle pointer plus an optional name-tag label — the label is skipped entirely on a context that doesn't implement `fillText` (see `InteractiveLayerContext`'s doc) rather than throwing. */
  private drawRemoteCursors(cursors: readonly RemoteCursorOverlay[], camera: Camera): void {
    if (cursors.length === 0) return;
    for (const cursor of cursors) {
      const screen = sceneToScreen(cursor.point, camera);
      this.ctx.save();
      this.ctx.fillStyle = cursor.color;
      this.ctx.strokeStyle = cursor.color;
      this.ctx.setLineDash([]);
      this.ctx.lineWidth = 1;

      this.ctx.beginPath();
      this.ctx.moveTo(screen.x, screen.y);
      this.ctx.lineTo(screen.x, screen.y + REMOTE_CURSOR_SIZE_PX);
      this.ctx.lineTo(screen.x + REMOTE_CURSOR_SIZE_PX * 0.7, screen.y + REMOTE_CURSOR_SIZE_PX * 0.7);
      this.ctx.closePath();
      this.ctx.fill();

      if (this.ctx.fillText) {
        this.ctx.font = "11px system-ui, sans-serif";
        this.ctx.fillText(cursor.name, screen.x + REMOTE_CURSOR_SIZE_PX + 2, screen.y + REMOTE_CURSOR_SIZE_PX);
      }
      this.ctx.restore();
    }
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

  /** The in-progress lasso loop as a translucent-filled dashed outline, mirroring the marquee's colors so the two selection gestures read as the same family. */
  private drawLasso(path: readonly Point[], camera: Camera): void {
    if (path.length < 2) return;
    const screen = path.map((point) => sceneToScreen(point, camera));
    this.ctx.save();
    this.ctx.fillStyle = MARQUEE_FILL;
    this.ctx.strokeStyle = SELECTION_COLOR;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(screen[0]!.x, screen[0]!.y);
    for (const point of screen.slice(1)) this.ctx.lineTo(point.x, point.y);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
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
    // Everything below is drawn around the padded rect, not the element's own bounds, so the outline
    // never sits on top of the element's stroke and hides it — see `inflateSelectionBounds`. The select
    // tool hit-tests handles against this same padded rect.
    const padded = inflateSelectionBounds(frame.bounds, camera.zoom);
    const outline = frameOutlineScene(frame, padded).map((point) => sceneToScreen(point, camera));
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

    this.drawHandles(frame, padded, camera);
  }

  /** `bounds` is the padded rect from `drawSelectionFrame` — handles ride the outline the user sees. */
  private drawHandles(frame: SelectionFrame, bounds: SceneRect, camera: Camera): void {
    const toScreen = (local: Point) => sceneToScreen(rotatePointAroundCenter(local, frame.pivot, frame.angle), camera);
    const topCenterScreen = toScreen({ x: bounds.x + bounds.width / 2, y: bounds.y });
    const rotateScreen = toScreen(rotateHandlePosition(bounds, ROTATE_HANDLE_OFFSET_PX / camera.zoom));

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

    const handles = handlePositions(bounds);
    for (const id of RESIZE_HANDLE_IDS) this.drawHandleSquare(toScreen(handles[id]));
    this.ctx.restore();
  }

  private drawHandleSquare(center: Point): void {
    const half = HANDLE_SIZE_PX / 2;
    this.ctx.fillRect(center.x - half, center.y - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
    this.ctx.strokeRect(center.x - half, center.y - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
  }
}
