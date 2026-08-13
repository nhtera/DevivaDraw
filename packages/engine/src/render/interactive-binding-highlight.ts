/**
 * The suggested-binding halo: a thick translucent outline on a shape an arrow endpoint would attach
 * to right now. This is the whole "you can connect here" affordance, so what it traces has to be the
 * *bind* outline (`bindings/shape-outline-geometry.ts`), not the drawn silhouette — for a cloud or a
 * heart those differ, and haloing the puffy edge would promise an attachment point the endpoint then
 * does not use.
 *
 * A sibling of `interactive-layer.ts` rather than more methods on it: that file is already over the
 * house line-count guideline, and this is self-contained drawing with no state.
 */
import { shapeOutlineScenePoints } from "../bindings/shape-outline-geometry";
import type { AnyElement } from "../elements/element-types";
import type { Camera } from "./camera";
import { sceneToScreen } from "./camera";
import type { InteractiveLayerContext } from "./interactive-layer";

/** Excalidraw's suggested-binding colours: a light blue that reads on white, a deeper one that reads on the dark canvas. */
const HIGHLIGHT_COLOR = { light: "rgba(106,189,252,1)", dark: "rgba(3,93,161,1)" } as const;

/**
 * Screen-space stroke width bounds. The halo is overlay chrome, like the selection frame, so it is
 * measured in screen pixels and looks the same at 25% as at 400% zoom rather than growing with the
 * drawing. Within those bounds it still tracks the target's own stroke, so a heavy-outlined shape
 * gets a halo that actually surrounds its stroke instead of hiding inside it.
 */
const MIN_WIDTH_PX = 1.75;
const MAX_WIDTH_PX = 4;

function haloWidth(element: Pick<AnyElement, "strokeWidth">, zoom: number): number {
  return Math.min(Math.max(element.strokeWidth * zoom, MIN_WIDTH_PX), MAX_WIDTH_PX);
}

/**
 * Strokes a halo around each of `elements`. Called before the selection frame is drawn, so a shape
 * that is both highlighted and selected shows the selection outline on top.
 *
 * An ellipse-outlined shape needs a real curve primitive; `ellipse` is an optional member of the
 * minimal context surface, so on a context without it that one shape is skipped rather than
 * approximated with a polygon that would sit visibly off its own edge.
 */
export function drawBindingHighlights(
  ctx: InteractiveLayerContext,
  elements: readonly AnyElement[],
  camera: Camera,
  theme: "light" | "dark",
): void {
  if (elements.length === 0) return;

  ctx.save();
  ctx.strokeStyle = HIGHLIGHT_COLOR[theme];
  ctx.setLineDash([]);

  for (const element of elements) {
    ctx.lineWidth = haloWidth(element, camera.zoom);
    const outline = shapeOutlineScenePoints(element);

    if (outline) {
      if (outline.length < 2) continue;
      const screen = outline.map((point) => sceneToScreen(point, camera));
      ctx.beginPath();
      ctx.moveTo(screen[0]!.x, screen[0]!.y);
      for (const point of screen.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.stroke();
      continue;
    }

    if (!ctx.ellipse) continue; // ellipse-kind shape on a context without the primitive — see the doc above
    const center = sceneToScreen({ x: element.x + element.width / 2, y: element.y + element.height / 2 }, camera);
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, (element.width / 2) * camera.zoom, (element.height / 2) * camera.zoom, element.angle, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
