/**
 * SVG fragment builders for the three element types that never go through rough.js's sketchy dispatch
 * (`svg-shape-paths.ts`): freedraw ink, text, and images — mirroring `render/freedraw-renderer.ts`,
 * `render/text-renderer.ts`, and `render/image-renderer.ts`'s canvas paint calls, just emitting SVG
 * markup instead. Positioning math (word-wrap, vertical/horizontal alignment) is reused directly from
 * `text-renderer.ts`'s exported helpers rather than re-derived, so wrapping/alignment can never drift
 * between the canvas and SVG output.
 */
import type { EmbedElement } from "../elements/embed-element";
import type { FreedrawElement } from "../elements/freedraw-element";
import { imageScaleOf } from "../elements/image-element";
import type { ImageElement } from "../elements/image-element";
import type { TextAlign, TextElement } from "../elements/text-element";
import { computeFreedrawOutline } from "../render/freedraw-renderer";
import type { ImageFileLookup } from "../render/image-renderer";
import type { Camera } from "../render/camera";
import { screenRectOf } from "../render/rough-shape-geometry";
import { horizontalAnchorPx, verticalStartOffsetPx } from "../render/text-renderer";
import { TEXT_FONT_FAMILY_CSS } from "../text/font-loading";
import { buildFontCssString, wrapText } from "../text/text-measurement";
import type { TextMeasurer } from "../text/text-measurement";
import { escapeXmlAttribute, escapeXmlText } from "./svg-escape";

/** Filled ink outline, mirroring `freedraw-renderer.ts`'s `drawElementFreedraw` fill call — no stroke, matching the canvas path exactly. Returns `""` for an empty stroke. */
export function buildFreedrawSvgFragment(element: FreedrawElement, camera: Camera): string {
  const outline = computeFreedrawOutline(element, camera);
  const first = outline[0];
  if (!first) return "";
  const d = [`M ${first[0]} ${first[1]}`, ...outline.slice(1).map(([x, y]) => `L ${x} ${y}`), "Z"].join(" ");
  // A highlighter exports translucent (matching its on-canvas alpha) so the mark tints rather than covers.
  const fillOpacity = element.highlighter ? ' fill-opacity="0.4"' : "";
  return `<path d="${d}" fill="${escapeXmlAttribute(element.strokeColor)}" stroke="none"${fillOpacity} />`;
}

const SVG_TEXT_ANCHOR: Record<TextAlign, string> = { left: "start", center: "middle", right: "end" };

/**
 * One `<text>` element per wrapped line, positioned/aligned identically to `text-renderer.ts`'s canvas
 * paint call — each line centered in its `lineHeightPx` line box (`dominant-baseline="central"` is
 * SVG's equivalent of canvas's `textBaseline: "middle"`, `y` at the line-box center), the same
 * leading-aware placement the canvas and the editing `<textarea>` use so exports match on-screen text.
 * Returns `""` for empty text (matches `drawElementText`'s no-op).
 */
export function buildTextSvgFragment(element: TextElement, camera: Camera, measurer: TextMeasurer): string {
  if (element.text === "") return "";

  const rect = screenRectOf(element, camera);
  const screenFontSizePx = element.fontSize * camera.zoom;
  const fontCss = buildFontCssString(screenFontSizePx, TEXT_FONT_FAMILY_CSS[element.fontFamily], { weight: element.fontWeight, style: element.fontStyle });
  const maxWidthPx = element.containerId ? rect.width : Number.POSITIVE_INFINITY;
  const lines = wrapText(element.text, { measurer, fontCss, maxWidth: maxWidthPx });
  const lineHeightPx = screenFontSizePx * element.lineHeight;
  const blockHeightPx = lineHeightPx * lines.length;
  const startY = rect.y + verticalStartOffsetPx(element.verticalAlign, rect.height, blockHeightPx);
  const anchorX = horizontalAnchorPx(element.textAlign, rect);
  const anchor = SVG_TEXT_ANCHOR[element.textAlign];
  const fontFamily = escapeXmlAttribute(TEXT_FONT_FAMILY_CSS[element.fontFamily]);
  const fill = escapeXmlAttribute(element.strokeColor);
  const weightAttr = element.fontWeight === "bold" ? ` font-weight="bold"` : "";
  const styleAttr = element.fontStyle === "italic" ? ` font-style="italic"` : "";

  return lines
    .map((line, index) => {
      const y = startY + index * lineHeightPx + lineHeightPx / 2;
      return (
        `<text x="${anchorX}" y="${y}" font-size="${screenFontSizePx}" font-family="${fontFamily}"${weightAttr}${styleAttr} ` +
        `text-anchor="${anchor}" dominant-baseline="central" fill="${fill}">${escapeXmlText(line)}</text>`
      );
    })
    .join("");
}

/**
 * Embeds the referenced file's `dataURL` directly as the `<image>`'s `href` (no external file
 * reference — an exported SVG must be a fully self-contained document), or a red-outlined placeholder
 * rect matching `image-renderer.ts`'s "missing file" fallback when the file isn't in `files`.
 */
export function buildImageSvgFragment(element: ImageElement, camera: Camera, files: ImageFileLookup): string {
  const rect = screenRectOf(element, camera);
  if (rect.width <= 0 || rect.height <= 0) return "";

  const file = files.getFile(element.fileId);
  if (!file) {
    return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#ffe3e3" stroke="#e03131" stroke-width="2" />`;
  }
  // Mirrored images carry their flip on the element (see `ImageElement.scale`); reproduce it here as
  // a transform about the image's own centre, or an exported flip would silently come back unflipped.
  const [scaleX, scaleY] = imageScaleOf(element);
  const transform =
    scaleX < 0 || scaleY < 0
      ? ` transform="translate(${rect.x + rect.width / 2} ${rect.y + rect.height / 2}) scale(${scaleX < 0 ? -1 : 1} ${scaleY < 0 ? -1 : 1}) translate(${-(rect.x + rect.width / 2)} ${-(rect.y + rect.height / 2)})"`
      : "";
  return (
    `<image x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" ` +
    `href="${escapeXmlAttribute(file.dataURL)}" preserveAspectRatio="none"${transform} />`
  );
}

/**
 * Placeholder card for an `EmbedElement` in an SVG export — a live cross-origin iframe can't be
 * rasterized, so exports show the same rounded card + host label the canvas placeholder draws.
 */
export function buildEmbedSvgFragment(element: EmbedElement, camera: Camera): string {
  const rect = screenRectOf(element, camera);
  let host = "embed";
  try {
    host = new URL(element.url).hostname.replace(/^www\./, "");
  } catch {
    /* leave the fallback label */
  }
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return (
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="10" fill="#f1f3f5" stroke="#adb5bd" stroke-width="1.5" />` +
    `<text x="${cx}" y="${cy}" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle" dominant-baseline="central" fill="#495057">▶ ${escapeXmlText(host)}</text>`
  );
}
