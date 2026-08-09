/**
 * Laser pointer: an ephemeral, fading trail that follows a press-drag — a presentation aid (point at
 * things while screen-sharing or in a live collab session) that Excalidraw/tldraw both offer. It
 * never touches `Scene` or history: points are just timestamped and kept in memory, and each one
 * fades out over {@link LASER_FADE_MS} before being pruned, so the trail dissolves on its own a moment
 * after you stop moving. The interactive (overlay) layer redraws every frame, so reading `getTrail()`
 * there animates the fade with no separate timer.
 *
 * `now` is injected (defaults to `Date.now`) purely so the fade is unit-testable with a controllable
 * clock, the same measurement-seam pattern the text/image tools use for their own environment deps.
 */
import { NoOpToolHandler } from "../input/tool-handler";
import type { Point } from "../render/camera";

/** How long (ms) a trail point takes to fade from fully opaque to gone. */
export const LASER_FADE_MS = 1000;

interface TimedPoint {
  x: number;
  y: number;
  t: number;
}

/** A trail point resolved for drawing: scene position plus its current fade opacity (1 = freshest, →0 = about to vanish). */
export interface LaserTrailPoint {
  x: number;
  y: number;
  opacity: number;
}

export interface LaserToolDeps {
  /** Current time in ms — defaults to `Date.now`; injected for deterministic fade tests. */
  now?: () => number;
}

export class LaserTool extends NoOpToolHandler {
  private readonly now: () => number;
  private points: TimedPoint[] = [];

  constructor(deps: LaserToolDeps = {}) {
    super();
    this.now = deps.now ?? Date.now;
  }

  override onGestureStart(point: Point): void {
    this.addPoint(point);
  }

  override onGestureMove(point: Point): void {
    this.addPoint(point);
  }

  // Gesture end/cancel intentionally keep the points: the trail fades out by age, it isn't cleared on
  // release — that's what makes it dissolve smoothly a beat after the pointer stops rather than snap away.

  /** The still-visible trail (oldest→newest), each point carrying its fade opacity. Prunes fully-faded points as a side effect, so it doubles as the trail's garbage collector — call it once per frame. */
  getTrail(): LaserTrailPoint[] {
    const now = this.now();
    this.points = this.points.filter((point) => now - point.t <= LASER_FADE_MS);
    return this.points.map((point) => ({ x: point.x, y: point.y, opacity: 1 - (now - point.t) / LASER_FADE_MS }));
  }

  private addPoint(point: Point): void {
    this.points.push({ x: point.x, y: point.y, t: this.now() });
  }
}
