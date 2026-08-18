/**
 * Frames → a `.pptx` presentation, one slide per frame, each slide a single full-bleed picture.
 *
 * Pictures rather than editable vector shapes: a faithful DrawingML translation of every element type
 * this editor can draw is a different project entirely, and a deck of images is what the export is
 * actually for — showing the work, not handing it over for editing in another tool. What a slide shows
 * is therefore exactly what per-frame PNG export already produces, because the caller renders the
 * frames through that same pipeline and hands the bytes here.
 *
 * Rendering is the caller's job (this module takes finished PNG bytes) so the exporter is a pure byte
 * function with no canvas, no DOM, and no async: every part of it is testable in a plain unit test.
 * There is no memory saving in rendering lazily either — every slide's PNG ends up in the archive.
 *
 * A PPTX has ONE deck-wide slide size, so mixed-aspect slides cannot each keep their own. The first
 * slide sets the aspect and every other slide is letterboxed into it, centered. A deck whose frames
 * are deliberately different shapes will show bands around the odd ones; per-slide scaling is not
 * something the format offers, and cropping instead of letterboxing would silently lose drawing.
 */
import { contentTypesPart, PACKAGE_RELS, presentationPart, presentationRels, SLIDE_LAYOUT, SLIDE_LAYOUT_RELS, SLIDE_MASTER, SLIDE_MASTER_RELS, slidePart, slideRels, THEME } from "./pptx-parts";
import { ZipWriter } from "./zip-writer";

/** English Metric Units per inch — the unit every OOXML geometry value is expressed in. */
export const EMU_PER_INCH = 914_400;
/** 7.5 inches: the height of both the classic 4:3 and the widescreen 16:9 slide, so width alone carries the aspect. */
const SLIDE_HEIGHT_EMU = 7.5 * EMU_PER_INCH;
/**
 * Aspect bounds for the deck. A frame 40× wider than it is tall is a banner, not a slide, and letting
 * it set the deck size would make every other slide a sliver — clamping keeps one odd frame from
 * ruining the deck, at the cost of letterboxing that frame instead.
 */
const MIN_ASPECT = 0.25;
const MAX_ASPECT = 4;

export interface PptxSlideInput {
  /** Frame name — becomes the picture's shape name, which is what a consumer shows in its selection pane. */
  name: string;
  /**
   * The RENDERED image's size, not the frame element's own. Only the ratio matters, and it must be
   * the ratio of the bytes in `png`: the picture is placed with a stretch fill, so a mismatch here
   * does not letterbox — it distorts. A frame whose contents overhang its rectangle renders larger
   * than the frame, which is exactly when the two differ.
   */
  width: number;
  height: number;
  /** The rendered frame, as PNG bytes. */
  png: Uint8Array;
}

export interface PptxExportOptions {
  slides: readonly PptxSlideInput[];
  /** Timestamp for every archive entry — injected so the same deck exports byte-identically twice. */
  now: number;
}

/** Deck slide size in EMU, derived from `first`'s aspect ratio — the first slide's rendered image (16:9 when there is nothing to derive from). */
export function slideSizeEmu(first: { width: number; height: number } | undefined): { cx: number; cy: number } {
  const raw = first && first.width > 0 && first.height > 0 ? first.width / first.height : 16 / 9;
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, raw));
  return { cx: Math.round(SLIDE_HEIGHT_EMU * aspect), cy: SLIDE_HEIGHT_EMU };
}

/** `image` scaled to fit inside the slide without distortion, centered — the letterbox placement. */
export function letterbox(image: { width: number; height: number }, slide: { cx: number; cy: number }): { offset: { x: number; y: number }; extent: { cx: number; cy: number } } {
  // A degenerate size (zero or negative in either axis) fills the slide rather than dividing by zero;
  // there is no aspect to preserve, and an empty slide would hide that the frame was exported at all.
  if (!(image.width > 0) || !(image.height > 0)) return { offset: { x: 0, y: 0 }, extent: { cx: slide.cx, cy: slide.cy } };
  const scale = Math.min(slide.cx / image.width, slide.cy / image.height);
  const cx = Math.round(image.width * scale);
  const cy = Math.round(image.height * scale);
  return { offset: { x: Math.round((slide.cx - cx) / 2), y: Math.round((slide.cy - cy) / 2) }, extent: { cx, cy } };
}

/** The finished `.pptx` archive. Throws on an empty deck — a presentation with no slides is not a file worth writing. */
export function exportFramesToPptx(options: PptxExportOptions): Uint8Array {
  const { slides, now } = options;
  if (slides.length === 0) throw new Error("export-to-pptx: a presentation needs at least one slide");

  const slideSize = slideSizeEmu(slides[0]);
  const zip = new ZipWriter(now);

  zip.addText("[Content_Types].xml", contentTypesPart(slides.length));
  zip.addText("_rels/.rels", PACKAGE_RELS);
  zip.addText("ppt/presentation.xml", presentationPart(slides.length, slideSize.cx, slideSize.cy));
  zip.addText("ppt/_rels/presentation.xml.rels", presentationRels(slides.length));
  zip.addText("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER);
  zip.addText("ppt/slideMasters/_rels/slideMaster1.xml.rels", SLIDE_MASTER_RELS);
  zip.addText("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT);
  zip.addText("ppt/slideLayouts/_rels/slideLayout1.xml.rels", SLIDE_LAYOUT_RELS);
  zip.addText("ppt/theme/theme1.xml", THEME);

  slides.forEach((slide, index) => {
    const number = index + 1;
    const placement = letterbox(slide, slideSize);
    zip.addText(`ppt/slides/slide${number}.xml`, slidePart(slide.name || `Slide ${number}`, placement.offset, placement.extent));
    zip.addText(`ppt/slides/_rels/slide${number}.xml.rels`, slideRels(number));
    zip.addFile(`ppt/media/image${number}.png`, slide.png);
  });

  return zip.toBytes();
}
