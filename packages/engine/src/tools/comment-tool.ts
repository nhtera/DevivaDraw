/**
 * Drops a comment pin. A click on a shape anchors the thread to that shape (so the pin rides its
 * move/resize/rotate); a click on empty canvas anchors it to that absolute point.
 *
 * The thread is created HERE, in the engine, rather than in the React layer, so every host — the
 * shell, a headless/MCP host, a future desktop-only surface — places comments through one code path
 * with one anchoring rule. The host contributes only what the engine cannot know: who the author is,
 * and what to open once the pin exists.
 *
 * This tool never touches history: comment mutations are deliberately outside undo (see
 * `comments/comments-store.ts`).
 */
import { anchorForElementPoint } from "../comments/comment-anchor";
import type { CommentThread } from "../comments/comment-types";
import { createCommentThread } from "../comments/comment-types";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { topmostElementAt } from "../selection/hit-test";

/** Scene-space slack for the "did the click land on a shape?" test — the same order as a select click, so pinning feels like selecting. */
const COMMENT_HIT_TOLERANCE = 10;

export interface CommentToolDeps {
  scene: Scene;
  /** Who is commenting — the host's ephemeral collab identity; there are no accounts. */
  author(): { id: string; name: string };
  /** Fires once the pin exists, with the new thread — the host opens its composer on it. Not called when the thread was refused (e.g. the store is at its cap). */
  onThreadCreated?(thread: CommentThread): void;
}

export class CommentTool extends NoOpToolHandler {
  private readonly deps: CommentToolDeps;

  constructor(deps: CommentToolDeps) {
    super();
    this.deps = deps;
  }

  /**
   * Placed on gesture END, not start: a comment pin is a click affordance, and committing on
   * pointerdown would drop a pin during a gesture the user goes on to abandon.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `modifiers` exists to satisfy `ToolHandler`; a comment pin has no modifier behaviour.
  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    this.placeAt(point);
  }

  /** Places a pin at `point` and returns the new thread, or `null` if the store refused it. Public so a headless host can place a comment without synthesizing a pointer gesture. */
  placeAt(point: Point): CommentThread | null {
    const { scene } = this.deps;
    // `topmostElementAt` already excludes hidden-layer, layer-locked, and deleted elements — the same
    // choke point select-click uses, so "what you can click" means one thing across the app.
    const target = topmostElementAt(scene, point, COMMENT_HIT_TOLERANCE);
    const author = this.deps.author();
    const anchor = target ? anchorForElementPoint(target, point) : ({ kind: "point", x: point.x, y: point.y } as const);

    const thread = scene.addCommentThread(createCommentThread({ anchor, authorId: author.id, authorName: author.name }));
    if (thread) this.deps.onThreadCreated?.(thread);
    return thread;
  }
}
