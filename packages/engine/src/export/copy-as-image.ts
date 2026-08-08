/**
 * "Copy as image" — the same PNG-rendering path as `export-to-png.ts`'s file export, just written to
 * the system clipboard instead of triggering a download. `ClipboardItem` construction and the
 * clipboard write itself are both injected (mirroring every other DOM-adjacent seam in this package —
 * `text/text-measurement.ts`'s `TextMeasurer`, `images/insert-image-file.ts`'s `decodeNaturalSize`)
 * so this orchestration is unit-testable in Node with fakes; the real browser adapter passes
 * `navigator.clipboard` and `(blob) => new ClipboardItem({ "image/png": blob })`.
 */
import { exportToPng } from "./export-to-png";
import type { ExportToPngOptions } from "./export-to-png";

/** The subset of the Clipboard API this module needs — `navigator.clipboard` satisfies it. */
export interface ClipboardWriterLike {
  write(items: unknown[]): Promise<void>;
}

export interface CopyAsImageOptions extends ExportToPngOptions {
  clipboard: ClipboardWriterLike;
  /** Builds the platform `ClipboardItem` wrapping the PNG blob — see the module doc for the injection rationale. */
  createClipboardItem: (blob: Blob) => unknown;
}

/** Exports the scene/selection to PNG (same options/rendering path as `exportToPng`) and writes the result to the system clipboard instead of returning a downloadable blob. */
export async function copyAsImage(options: CopyAsImageOptions): Promise<void> {
  const { clipboard, createClipboardItem, ...exportOptions } = options;
  const blob = await exportToPng(exportOptions);
  await clipboard.write([createClipboardItem(blob)]);
}
