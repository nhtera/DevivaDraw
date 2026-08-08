/**
 * SVG fragment builders for the three element types that never go through rough.js's sketchy dispatch
 * (`svg-shape-paths.ts`): freedraw ink, text, and images — mirroring `render/freedraw-renderer.ts`,
 * `render/text-renderer.ts`, and `render/image-renderer.ts`'s canvas paint calls, just emitting SVG
 * markup instead. Positioning math (word-wrap, vertical/horizontal alignment) is reused directly from
 * `text-renderer.ts`'s exported helpers rather than re-derived, so wrapping/alignment can never drift
 * between the canvas and SVG output.
 */
import type { FreedrawElement } from "../elements/freedraw-element";
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
  return `<path d="${d}" fill="${escapeXmlAttribute(element.strokeColor)}" stroke="none" />`;
}

const SVG_TEXT_ANCHOR: Record<TextAlign, string> = { left: "start", center: "middle", right: "end" };

/**
 * One `<text>` element per wrapped line, positioned/aligned identically to `text-renderer.ts`'s canvas
 * paint call — `dominant-baseline="hanging"` is SVG's equivalent of canvas's `textBaseline: "top"`, so
 * `y` can reuse the exact same `verticalStartOffsetPx` value without a hand-tuned baseline offset
 * constant. Returns `""` for empty text (matches `drawElementText`'s no-op).
 */
export function buildTextSvgFragment(element: TextElement, camera: Camera, measurer: TextMeasurer): string {
  if (element.text === "") return "";

  const rect = screenRectOf(element, camera);
  const screenFontSizePx = element.fontSize * camera.zoom;
  const fontCss = buildFontCssString(screenFontSizePx, TEXT_FONT_FAMILY_CSS[element.fontFamily]);
  const maxWidthPx = element.containerId ? rect.width : Number.POSITIVE_INFINITY;
  const lines = wrapText(element.text, { measurer, fontCss, maxWidth: maxWidthPx });
  const lineHeightPx = screenFontSizePx * element.lineHeight;
  const blockHeightPx = lineHeightPx * lines.length;
  const startY = rect.y + verticalStartOffsetPx(element.verticalAlign, rect.height, blockHeightPx);
  const anchorX = horizontalAnchorPx(element.textAlign, rect);
  const anchor = SVG_TEXT_ANCHOR[element.textAlign];
  const fontFamily = escapeXmlAttribute(TEXT_FONT_FAMILY_CSS[element.fontFamily]);
  const fill = escapeXmlAttribute(element.strokeColor);

  return lines
    .map((line, index) => {
      const y = startY + index * lineHeightPx;
      return (
        `<text x="${anchorX}" y="${y}" font-size="${screenFontSizePx}" font-family="${fontFamily}" ` +
        `text-anchor="${anchor}" dominant-baseline="hanging" fill="${fill}">${escapeXmlText(line)}</text>`
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
  return (
    `<image x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" ` +
    `href="${escapeXmlAttribute(file.dataURL)}" preserveAspectRatio="none" />`
  );
}
