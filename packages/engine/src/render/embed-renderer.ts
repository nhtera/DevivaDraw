/**
 * Canvas placeholder for an `EmbedElement`: a rounded card with a border and the embedded URL's host,
 * drawn on the static layer. The *live* content is a sandboxed `<iframe>` the host app overlays in
 * screen space (see `@deviva-draw/react`'s embed overlay); this placeholder is what shows underneath
 * it, and — crucially — what appears in PNG/SVG exports (which can't rasterize a live cross-origin
 * iframe). Rotation/opacity are wrapped exactly like the other renderers.
 */
import type { EmbedElement } from "../elements/embed-element";
import type { Camera } from "./camera";
import type { RoughDrawContext2D } from "./rough-renderer";
import { screenRectOf } from "./rough-shape-geometry";

export interface EmbedDrawContext2D extends RoughDrawContext2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillText(text: string, x: number, y: number): void;
  beginPath(): void;
  roundRect(x: number, y: number, w: number, h: number, radii: number): void;
  fill(): void;
  stroke(): void;
}

/** Short label for the card — the URL's host without a leading `www.`, or "embed" if unparseable. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "embed";
  }
}

export function drawElementEmbed(ctx: EmbedDrawContext2D, element: EmbedElement, camera: Camera): void {
  const rect = screenRectOf(element, camera);
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, element.opacity / 100));
  if (element.angle !== 0) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(element.angle);
    ctx.translate(-cx, -cy);
  }

  const radius = Math.min(10 * camera.zoom, rect.width / 2, rect.height / 2);
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fillStyle = "#f1f3f5";
  ctx.fill();
  ctx.strokeStyle = "#adb5bd";
  ctx.lineWidth = Math.max(1, 1.5 * camera.zoom);
  ctx.stroke();

  ctx.fillStyle = "#495057";
  ctx.font = `${Math.max(10, 13 * camera.zoom)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`▶ ${hostLabel(element.url)}`, rect.x + rect.width / 2, rect.y + rect.height / 2);

  ctx.restore();
}
