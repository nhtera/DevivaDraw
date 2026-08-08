/**
 * Real browser `decodeNaturalSize` for `insertImageFile`/`usePasteAndDrop` — resolves a pasted/
 * dropped image's intrinsic pixel size via the engine's `createBrowserImageDecoder()` (an
 * `Image()`-backed decode), then reports its `naturalWidth`/`naturalHeight`. Kept as its own tiny
 * module (rather than inlined into the harness component) so it stays independently readable and
 * swappable — the engine-side unit tests instead inject a synchronous fake for this exact seam.
 */
import { createBrowserImageDecoder } from "@deviva-draw/engine";
import type { DecodeNaturalSizeFn } from "@deviva-draw/engine";

const decodeImage = createBrowserImageDecoder();

export const decodeNaturalSize: DecodeNaturalSizeFn = async (dataURL) => {
  const image = await decodeImage(dataURL);
  return { width: image.naturalWidth, height: image.naturalHeight };
};
