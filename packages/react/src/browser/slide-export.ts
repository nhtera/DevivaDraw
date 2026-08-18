/**
 * Deck exports: the scene's frames, in slide order, written out as a `.pptx` or a multi-page PDF.
 *
 * Both formats render each frame through the SAME per-frame PNG path the export dialog's "current
 * frame" scope already uses (`renderSceneToPngBlob` with the frame and its contents as the element
 * scope), so a slide shows exactly what exporting that one frame as a PNG would show — one rendering
 * pipeline, not a second one that could drift from it.
 *
 * Padding is `0` rather than the default export margin: a slide should be the frame edge to edge, and
 * a margin would also change the rendered aspect ratio away from the frame's own, which is what the
 * PPTX deck size is derived from.
 *
 * Order comes from `orderedSceneFrames` — the same function the presentation walk uses. Raw scene
 * order is deliberately not an option here: a deck using numeric name prefixes would export its
 * slides in a different order than Present shows them, which is a bug this codebase has already had
 * once.
 */
import { exportFramesToPptx, frameContainedElementIds, readPngPixelSize } from "@deviva-draw/engine";
import type { AnyElement, ExportScale, FrameElement, Scene } from "@deviva-draw/engine";
import { orderedSceneFrames } from "../components/presentation/frame-slide-order";
import { triggerDownload } from "./persistence-adapters";
import { renderSceneToPngBlob } from "./scene-file-operations";
import type { ExportRenderExtras } from "./scene-file-operations";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export interface SlideScope {
  frame: FrameElement;
  /** The frame element plus its contents — the frame itself is included so the slide keeps the border the user sees on canvas. */
  elements: AnyElement[];
}

/** The scene's deck: every live frame in slide order, with the elements it contains. Empty when the scene has no frames. */
export function sceneSlideScopes(scene: Scene): SlideScope[] {
  return orderedSceneFrames(scene.getElements()).map((frame) => ({
    frame: frame as FrameElement,
    elements: [
      frame as AnyElement,
      ...frameContainedElementIds(scene, frame.id)
        .map((id) => scene.getElement(id))
        .filter((element): element is AnyElement => Boolean(element && !element.isDeleted)),
    ],
  }));
}

/** Thrown when a deck export is asked for on a scene with no frames — the dialog disables the action, so this is the programmatic guard. */
export class NoFramesToExportError extends Error {
  constructor() {
    super("slide-export: the scene has no frames to export as slides");
    this.name = "NoFramesToExportError";
  }
}

async function renderSlidePng(scene: Scene, scope: SlideScope, scale: ExportScale, background: string | null, extras: ExportRenderExtras): Promise<Blob> {
  return renderSceneToPngBlob(scene, scale, background, { ...extras, elements: scope.elements, padding: 0 });
}

/** Exports every frame as a slide in a `.pptx` and triggers the download. */
export async function exportSceneSlidesPptxFile(scene: Scene, scale: ExportScale = 2, background: string | null = scene.getBackground(), extras: ExportRenderExtras = {}): Promise<void> {
  const scopes = sceneSlideScopes(scene);
  if (scopes.length === 0) throw new NoFramesToExportError();

  const slides = [];
  for (const scope of scopes) {
    // Sequential on purpose: each render allocates a full-size offscreen canvas, and a large deck
    // rendering every slide at once is how an export runs the tab out of memory.
    const blob = await renderSlidePng(scene, scope, scale, background, extras);
    const png = new Uint8Array(await blob.arrayBuffer());
    // The size passed on is the RENDERED image's, not the frame's own. Those differ whenever an
    // element belongs to the frame but sticks out past its rectangle (membership is by an element's
    // centre, so a wide arrow can overhang) — the render's bounds are the union of what it drew.
    // Sizing the slide from the frame instead would place that wider image into a narrower box and
    // the exporter's `stretch` fill would visibly distort it.
    const size = readPngPixelSize(png) ?? { width: scope.frame.width, height: scope.frame.height };
    slides.push({ name: scope.frame.name, width: size.width, height: size.height, png });
  }

  const bytes = exportFramesToPptx({ slides, now: Date.now() });
  triggerDownload("slides.pptx", new Blob([bytes as BlobPart], { type: PPTX_MIME }), PPTX_MIME);
}

/**
 * Exports every frame as one page of a PDF.
 *
 * Unlike PPTX — which has a single deck-wide slide size — PDF sizes each page independently, so a
 * mixed-aspect deck keeps every frame at its own shape here with no letterboxing.
 */
export async function exportSceneSlidesPdfFile(scene: Scene, scale: ExportScale = 2, background: string = scene.getBackground() ?? "#ffffff", extras: ExportRenderExtras = {}): Promise<void> {
  const scopes = sceneSlideScopes(scene);
  if (scopes.length === 0) throw new NoFramesToExportError();

  const { jsPDF } = await import("jspdf");
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const scope of scopes) {
    const dataUrl = await blobToDataUrl(await renderSlidePng(scene, scope, scale, background, extras));
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    const orientation = width >= height ? "landscape" : "portrait";
    if (!pdf) pdf = new jsPDF({ orientation, unit: "px", format: [width, height] });
    else pdf.addPage([width, height], orientation);
    pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
  }
  pdf!.save("slides.pdf");
}

/** Local copy of the reader `scene-file-operations.ts` uses — not exported there, and one `FileReader` wrapper is not worth widening that module's surface for. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("slide-export: could not read the rendered slide"));
    reader.readAsDataURL(blob);
  });
}
