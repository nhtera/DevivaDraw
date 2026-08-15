/**
 * Renders a scene (or a selection subset) to a standalone SVG document string. Shapes/arrows go
 * through rough.js's own SVG-path mode (`svg-shape-paths.ts`, reusing `RoughGenerator.toPaths()`) —
 * the exact sketchy-rendering algorithm the live canvas uses, just emitting path data instead of
 * painting — so the exported SVG looks identical to the canvas, deterministically (same per-element
 * `seed`). Freedraw/text/image go through `svg-text-freedraw-image.ts`'s equivalents. The live scene
 * JSON is embedded as an SVG `<metadata>` block by default, mirroring `export-to-png.ts`'s `tEXt`-chunk
 * embedding, so a previously-exported SVG can later be re-opened as an editable scene.
 */
import type { AnyElement } from "../elements/element-types";
import { isMirrored, mirrorScaleOf } from "../elements/element-mirror";
import { serializeScene } from "../persistence/serialize-scene";
import type { Camera } from "../render/camera";
import { screenRectOf } from "../render/rough-shape-geometry";
import type { Scene } from "../scene/scene";
import type { TextMeasurer } from "../text/text-measurement";
import { filterVisibleElements } from "../render/viewport-culling";
import { computeExportBounds, computeExportFrame } from "./export-geometry";
import type { ExportScale } from "./export-geometry";
import { escapeXmlAttribute, escapeXmlText } from "./svg-escape";
import { buildArrowSvgFragment, buildRoughShapeSvgFragment } from "./svg-shape-paths";
import type { RoughSvgGenerator } from "./svg-shape-paths";
import { buildEmbedSvgFragment, buildFreedrawSvgFragment, buildImageSvgFragment, buildTextSvgFragment } from "./svg-text-freedraw-image";

export interface ExportToSvgOptions {
  scene: Scene;
  /** Headless rough.js generator (`rough.generator()`) — no `<canvas>` needed for SVG output. */
  roughGenerator: RoughSvgGenerator;
  textMeasurer: TextMeasurer;
  elements?: readonly AnyElement[];
  scale?: ExportScale;
  padding?: number;
  backgroundColor?: string | null;
  embedSceneData?: boolean;
}

/** Rotation and mirroring (both around the element's screen-space bbox center) + opacity wrap — the SVG equivalent of every canvas renderer's `save/translate/rotate/scale/globalAlpha/restore` block. */
function wrapElementFragment(inner: string, element: AnyElement, camera: Camera): string {
  if (!inner) return "";
  const opacity = Math.min(1, Math.max(0, element.opacity / 100));
  const rect = screenRectOf(element, camera);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  const parts: string[] = [];
  if (element.angle !== 0) parts.push(`rotate(${(element.angle * 180) / Math.PI} ${centerX} ${centerY})`);
  // Mirroring is applied after (i.e. inside) the rotation, matching the canvas renderers, so a
  // rotated-then-flipped element exports exactly as it appears on screen.
  if (isMirrored(element)) {
    const [scaleX, scaleY] = mirrorScaleOf(element);
    parts.push(`translate(${centerX} ${centerY}) scale(${scaleX < 0 ? -1 : 1} ${scaleY < 0 ? -1 : 1}) translate(${-centerX} ${-centerY})`);
  }

  const transform = parts.length > 0 ? ` transform="${parts.join(" ")}"` : "";
  return `<g opacity="${opacity}"${transform}>${inner}</g>`;
}

/** A frame's border + name label as SVG — the export counterpart to `render/frame-renderer.ts`, kept inline (a couple of tags) rather than as its own module. */
function buildFrameSvgFragment(element: AnyElement & { type: "frame" }, camera: Camera): string {
  const rect = screenRectOf(element, camera);
  const border = "rgba(130, 130, 140, 0.9)";
  const rectTag = `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="none" stroke="${border}" stroke-width="1.5" />`;
  const label = `<text x="${rect.x}" y="${rect.y - 6}" font-family="system-ui, sans-serif" font-size="12" fill="${border}">${escapeXmlText(element.name)}</text>`;
  return `${rectTag}${label}`;
}

function elementFragment(element: AnyElement, camera: Camera, generator: RoughSvgGenerator, textMeasurer: TextMeasurer, scene: Scene): string {
  switch (element.type) {
    case "freedraw":
      return buildFreedrawSvgFragment(element, camera);
    case "text":
      return buildTextSvgFragment(element, camera, textMeasurer);
    case "arrow":
      return buildArrowSvgFragment(generator, element, camera);
    case "image":
      return buildImageSvgFragment(element, camera, scene);
    case "embed":
      return buildEmbedSvgFragment(element, camera);
    case "frame":
      return buildFrameSvgFragment(element, camera);
    default:
      return buildRoughShapeSvgFragment(generator, element, camera);
  }
}

/** Renders `options.scene` (or `options.elements`) to a standalone `<svg>...</svg>` document string — see the module doc. */
export function exportToSvg(options: ExportToSvgOptions): string {
  const {
    scene,
    roughGenerator,
    textMeasurer,
    elements = scene.getElements().filter((element) => !element.isDeleted && !scene.isElementHidden(element)),
    scale = 1,
    padding,
    backgroundColor = null,
    embedSceneData = true,
  } = options;

  const bounds = computeExportBounds(elements, padding);
  const { camera, pixelWidth, pixelHeight } = computeExportFrame(bounds, scale);
  const visible = filterVisibleElements(elements, camera, { width: pixelWidth, height: pixelHeight });

  const body = visible.map((element) => wrapElementFragment(elementFragment(element, camera, roughGenerator, textMeasurer, scene), element, camera)).join("");

  const backgroundRect = backgroundColor
    ? `<rect x="0" y="0" width="${pixelWidth}" height="${pixelHeight}" fill="${escapeXmlAttribute(backgroundColor)}" />`
    : "";

  // Visible-only for the same reason as the PNG chunk: metadata must not carry what the pixels exclude.
  const metadata = embedSceneData ? `<metadata>${escapeXmlText(JSON.stringify(serializeScene(scene, { excludeHidden: true })))}</metadata>` : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${pixelWidth} ${pixelHeight}">`,
    metadata,
    backgroundRect,
    body,
    "</svg>",
  ].join("");
}

const METADATA_PATTERN = /<metadata>([\s\S]*?)<\/metadata>/;

/** Reverses `exportToSvg`'s `<metadata>` embedding — reads the scene JSON string back out of a previously-exported SVG document, or `null` if none was embedded. */
export function readEmbeddedSceneDataFromSvg(svg: string): string | null {
  const match = METADATA_PATTERN.exec(svg);
  if (!match) return null;
  return match[1]!.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}
