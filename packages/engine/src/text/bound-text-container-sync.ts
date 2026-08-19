/**
 * Keeps a bound text element glued to its container across *any* container transform — move,
 * resize, or rotate (rotate changes a container's `x/y` too when it orbits a group pivot, see
 * `selection/group-transform.ts`) — via a `Scene.registerUpdateHook`, the same wiring pattern
 * `bindings/binding-scene-sync.ts` uses to reroute bound arrows after their shape moves. Without this,
 * every tool that moves/resizes a container (the selection tool, but also any future one) would need
 * its own bespoke "and also reposition the label" logic; with it, that's automatic for all of them.
 *
 * Rotation: every element (see `render/text-renderer.ts`) is painted by rotating its own local box
 * around its *own* center by its *own* `angle` — spinning in place, not orbiting anything. So gluing
 * a bound text to a rotated container takes two independent things, not just copying `angle` across:
 * (1) the text's `angle` must match the container's, so it's oriented the same way, and (2) the
 * text's *position* must be walked around the container's center by that same angle — otherwise the
 * text spins in place at its old (unrotated-layout) position instead of following the container round.
 * `layoutBoundText` still computes the text's box in the container's own unrotated local frame (the
 * padding/alignment math is angle-agnostic); this module's job is exactly that one extra rotation step
 * on top, computed fresh from the container's *current* geometry every time so it composes correctly
 * with move+rotate (or resize+rotate) happening in the same gesture, not just a rotate in isolation.
 *
 * Idempotency is what keeps this safe from runaway recursion: `layoutBoundText` + the position/size
 * math below are pure functions of the container's *current* geometry, so a hook invocation that
 * finds nothing actually needs to change (the common case — most container updates aren't a
 * resize/move/rotate at all, e.g. a style-only color change) writes nothing and triggers no further
 * hook call. The one case that *does* recurse — a width change that also grows the container's
 * height — bottoms out in at most one extra pass: the second pass recomputes against the
 * now-already-grown height and finds it unchanged.
 */
import type { NoteElement } from "../elements/note-element";
import type { RectangleElement, EllipseElement, DiamondElement } from "../elements/shape-elements";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { BOUND_TEXT_PADDING, boundTextWrapWidth, layoutBoundText } from "./bound-text-layout";
import { findBoundTextRef, isBindableContainer } from "./bound-text";
import { TEXT_FONT_FAMILY_CSS } from "./font-loading";
import { buildFontCssString } from "./text-measurement";
import type { TextMeasurer } from "./text-measurement";
import type { VerticalAlign } from "../elements/text-element";

type Container = RectangleElement | EllipseElement | DiamondElement | NoteElement;

/** Rotates `point` by `radians` around `center` — a small local copy of the same trick `bindings/shape-border-intersection.ts`'s `rotatePoint` and `selection/selection-geometry.ts`'s `rotatePointAroundCenter` each keep their own copy of, so this module stays independent of the selection subsystem. */
function rotateAroundCenter(point: Point, center: Point, radians: number): Point {
  if (radians === 0) return point;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

function verticalOffset(align: VerticalAlign, containerHeight: number, textHeightPx: number): number {
  switch (align) {
    case "top":
      return BOUND_TEXT_PADDING;
    case "bottom":
      return containerHeight - textHeightPx - BOUND_TEXT_PADDING;
    case "middle":
      return (containerHeight - textHeightPx) / 2;
  }
}

function syncOnce(scene: Scene, container: Container, measurer: TextMeasurer): void {
  const textRef = findBoundTextRef(container);
  if (!textRef) return;
  const textElement = scene.getElement(textRef.id);
  if (!textElement || textElement.type !== "text" || textElement.isDeleted) return;

  const fontCss = buildFontCssString(textElement.fontSize, TEXT_FONT_FAMILY_CSS[textElement.fontFamily]);
  const layout = layoutBoundText(textElement.text, container, measurer, fontCss, textElement.fontSize, textElement.lineHeight);

  if (layout.requiredContainerHeight !== container.height) {
    scene.updateElement(container.id, { height: layout.requiredContainerHeight });
    return; // the resulting re-entrant hook call finishes the sync against the corrected height
  }

  // Layout in the container's own unrotated local frame first (padding/alignment is angle-agnostic)...
  const unrotatedX = container.x + BOUND_TEXT_PADDING;
  const unrotatedY = container.y + verticalOffset(textElement.verticalAlign, container.height, layout.textHeightPx);
  const nextWidth = boundTextWrapWidth(container);
  const nextHeight = layout.textHeightPx;

  // ...then walk that box's center around the container's actual (current) center by the container's
  // angle — see the module doc's rotation section for why this, not just copying `angle`, is required.
  const containerCenter = { x: container.x + container.width / 2, y: container.y + container.height / 2 };
  const unrotatedCenter = { x: unrotatedX + nextWidth / 2, y: unrotatedY + nextHeight / 2 };
  const rotatedCenter = rotateAroundCenter(unrotatedCenter, containerCenter, container.angle);
  const nextX = rotatedCenter.x - nextWidth / 2;
  const nextY = rotatedCenter.y - nextHeight / 2;
  const nextAngle = container.angle;

  if (
    textElement.x === nextX &&
    textElement.y === nextY &&
    textElement.width === nextWidth &&
    textElement.height === nextHeight &&
    textElement.angle === nextAngle
  ) {
    return;
  }
  scene.updateElement(textElement.id, { x: nextX, y: nextY, width: nextWidth, height: nextHeight, angle: nextAngle });
}

/**
 * Registers the sync hook on `scene`. `measurer` is required (unlike `binding-scene-sync.ts`'s
 * optional one) since every sync pass needs to re-wrap text to know its height — a headless
 * consumer with no text measurement available should simply not register this hook. Returns an
 * unregister function (mirrors `Scene.subscribe`/`registerUpdateHook`'s own shape).
 */
export function registerBoundTextContainerSyncHook(scene: Scene, measurer: TextMeasurer): () => void {
  return scene.registerUpdateHook((updated) => {
    if (updated.isDeleted) return;
    if (isBindableContainer(updated)) {
      syncOnce(scene, updated, measurer);
      return;
    }
    // The label's own half of the same glue. Restyling a bound text — a bigger font size, a wider
    // family — changes how much room it needs, and the container branch above never sees that
    // update, so the container would keep its old height and the label would spill out of it. Both
    // halves running the one idempotent `syncOnce` is what makes the pair consistent whichever side
    // moved; it also means a restyle arriving from a remote peer re-layouts exactly like a local one.
    if (updated.type !== "text" || !updated.containerId) return;
    const container = scene.getElement(updated.containerId);
    if (container && !container.isDeleted && isBindableContainer(container)) syncOnce(scene, container, measurer);
  });
}
