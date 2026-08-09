/**
 * Click-to-place standalone text tool: creates an empty `TextElement` at the click point and hands
 * off to `TextEditSession` for the actual typing. This tool's whole job ends the moment the draft
 * exists and a session is open — the (React-layer) overlay owns everything from there, same
 * division of labor bound-text editing uses (see `text/bound-text.ts`'s `startBoundTextEdit`).
 */
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { startStandaloneTextEdit } from "../text/standalone-text-edit";
import type { TextEditSession } from "../text/text-edit-session";
import type { TextMeasurer } from "../text/text-measurement";
import type { ShapeStyleState } from "./shape-style-state";

export interface TextToolDeps {
  scene: Scene;
  styleState: ShapeStyleState;
  editSession: TextEditSession;
  /** Measures the committed text's natural (unwrapped) size so the element's `width`/`height` — left at `0` by `createTextElement`'s defaults — match its actual rendered footprint once real text lands, for rotation-center/alignment math and future hit-testing/selection to work against. */
  measurer: TextMeasurer;
  /** Called once the draft is placed and its edit session is open — the host uses this to switch back to the select tool, the click-to-place-then-select UX every text tool in this genre uses. */
  onPlaced?: (elementId: string) => void;
}

export class TextTool extends NoOpToolHandler {
  private readonly deps: TextToolDeps;
  /** The element placed by the most recent `onGestureStart`, read back by `onGestureEnd` — see that method's doc for why `onPlaced` fires there instead of immediately. */
  private placedElementId: string | null = null;

  constructor(deps: TextToolDeps) {
    super();
    this.deps = deps;
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature; a plain click needs no modifier reads */
  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    const style = this.deps.styleState.getStyle();
    this.placedElementId = startStandaloneTextEdit(this.deps.scene, this.deps.editSession, this.deps.measurer, point, {
      strokeColor: style.strokeColor,
      opacity: style.opacity,
    });
  }

  /**
   * `onPlaced` fires here (gesture *end*, i.e. `pointerup`), not from `onGestureStart` — a click is
   * a full down-then-up gesture, and `ToolStateMachine` holds `isGestureInProgress()` true for that
   * *entire* window (see its own module doc: "switching mid-gesture is rejected, not queued"). A host
   * that (correctly, per `onPlaced`'s own doc) calls `toolStateMachine.setTool(...)` from this
   * callback needs that call to actually succeed — calling it from `onGestureStart` would hit that
   * still-in-progress gesture on every single placement and silently no-op forever, permanently
   * stranding the tool on "text" instead of handing back to selection.
   */
  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    const elementId = this.placedElementId;
    this.placedElementId = null;
    if (elementId) this.deps.onPlaced?.(elementId);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
