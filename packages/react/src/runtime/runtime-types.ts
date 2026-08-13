/** The fully-wired runtime `use-deviva-runtime.ts` builds once per mounted canvas — `ActionRuntime` plus the plumbing (pipeline, action registry, marquee/snap-guide readers) only the hook itself and `deviva-draw-app.tsx` need directly. */
import type { LaserTrailPoint, PointerEventPipeline, Point, SceneRect, SnapGuide } from "@deviva-draw/engine";
import type { ActionRegistry } from "../actions/action-registry";
import type { ActionRuntime } from "../actions/action-types";

export interface DevivaRuntime extends ActionRuntime {
  actionRegistry: ActionRegistry;
  pipeline: PointerEventPipeline;
  /** Live rubber-band marquee rect (scene space) for the interactive layer to draw, or `null` outside a marquee drag. */
  getMarqueeRect(): SceneRect | null;
  /** Live object-snap alignment guides for the interactive layer, or `[]` outside a snapping move. */
  getSnapGuides(): readonly SnapGuide[];
  /** Ids the eraser tool is previewing-to-delete this swipe (empty when idle) — the render loop dims these. */
  getPendingEraseIds(): ReadonlySet<string>;
  /** The laser pointer's live fading trail (empty when idle) — the interactive layer draws it each frame. */
  getLaserTrail(): readonly LaserTrailPoint[];
  /** The lasso tool's in-progress free-form loop (empty when idle) — the interactive layer draws it each frame. */
  getLassoPath(): readonly Point[];
  /** Shapes the arrow tool is offering as bind targets right now (empty when idle) — the interactive layer haloes them each frame. */
  getBindingHighlightIds(): readonly string[];
  /** Detaches the pointer pipeline, the double-click listener, and the binding/bound-text sync hooks — call from the owning effect's cleanup. */
  dispose(): void;
}
