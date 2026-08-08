/**
 * Wires native `paste`/`drop` DOM events to the engine's shared `insertImageFile` path — paste and
 * drag-drop are this package's two image-insertion entry points; a toolbar file-picker button (a
 * third entry point calling the exact same `insertImageFile`) is not yet implemented, tracked as a
 * follow-up UI affordance rather than built here. Not unit tested: `ClipboardEvent`/`DataTransfer`/
 * `File` DOM behavior doesn't exist in this package's node-based vitest environment (no `jsdom`),
 * same trade-off `components/text-editor-overlay.tsx` documents for its own DOM-only surface — the
 * actual item-classification logic this hook calls into (`clipboard-image-detection.ts`) is
 * separately pure/tested. Verified manually via `apps/web`'s composed app shell.
 *
 * Security: SVG paste is always routed through `insertImageFile` -> `Scene.files`' data-URL storage,
 * decoded and painted via `drawImage` (`render/image-renderer.ts`) — never `dangerouslySetInnerHTML`
 * or any other live-DOM SVG injection, which would risk executing an embedded `<script>`.
 *
 * Paste target guard: `paste` is bound to `window` (clipboard paste has no single natural DOM target
 * the way `drop` does), so a native paste into the in-canvas text editor's `<textarea>` — or any other
 * editable element on the page — would otherwise be observed by this same listener. `handlePaste`
 * gates every consume decision through `shouldConsumePaste` (`clipboard-image-detection.ts`) *before*
 * touching the clipboard asynchronously, so a paste while an editable element is focused is left
 * completely alone (no `preventDefault`, no image insert) — see that predicate's doc for the race it
 * closes.
 */
import { useEffect } from "react";
import type { RefObject } from "react";
import { insertImageFile, screenToScene } from "@deviva-draw/engine";
import type { Camera, Scene } from "@deviva-draw/engine";
import type { DecodeNaturalSizeFn } from "@deviva-draw/engine";
import { findFirstImageItem, looksLikeSvgMarkup, shouldConsumePaste, svgMarkupToBytes, SVG_MIME_TYPE } from "./clipboard-image-detection";
import type { ClipboardItemKind } from "./clipboard-image-detection";

export interface UsePasteAndDropOptions {
  containerRef: RefObject<HTMLElement | null>;
  /** `null` while the composed app shell's canvas hasn't finished mounting yet — the hook no-ops (no listeners attached) until a real `Scene` is available, re-attaching once it is (see its effect's dependency array). */
  scene: Scene | null;
  getCamera: () => Camera;
  /** CSS-pixel viewport size — used both to center a paste (no drop point) and to cap the fitted initial insert size. */
  getViewportSize: () => { width: number; height: number };
  decodeNaturalSize: DecodeNaturalSizeFn;
  maxFileSizeBytes?: number;
  /** Called when an insert is rejected (oversized file, undecodable image, ...); there's no toast/notification system yet, so the composed app shell just logs it (`console.warn`). */
  onInsertError?: (error: unknown) => void;
}

/** `UsePasteAndDropOptions` with `scene` narrowed to non-null — every helper below is only ever called from inside the effect's `!scene` early-return guard, via `narrowedOptions`. */
type ScenePresentOptions = UsePasteAndDropOptions & { scene: Scene };

async function insertBlobAt(blob: { type: string; arrayBuffer(): Promise<ArrayBuffer> }, position: { x: number; y: number }, options: ScenePresentOptions): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await insertImageFile({
    scene: options.scene,
    bytes,
    mimeType: blob.type,
    decodeNaturalSize: options.decodeNaturalSize,
    position,
    maxFitSize: options.getViewportSize(),
    maxFileSizeBytes: options.maxFileSizeBytes,
  });
}

function viewportCenter(options: ScenePresentOptions): { x: number; y: number } {
  const viewport = options.getViewportSize();
  return screenToScene({ x: viewport.width / 2, y: viewport.height / 2 }, options.getCamera());
}

/** Handles a clipboard image file item (screenshot, copied image, ...) — the common case. */
function tryPasteImageFile(items: DataTransferItemList, options: ScenePresentOptions): boolean {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== "file" || !findFirstImageItem([item])) continue;
    const file = item.getAsFile();
    if (!file) continue;
    insertBlobAt(file, viewportCenter(options), options).catch((error: unknown) => options.onInsertError?.(error));
    return true;
  }
  return false;
}

/**
 * Synchronous classification of what `items` might contain — see `ClipboardItemKind`'s doc. Reading
 * `kind`/`type` off each item is itself synchronous (unlike `getAsString`), so this is safe to compute
 * up front, before deciding (via `shouldConsumePaste`) whether to touch the clipboard any further.
 */
function collectClipboardItemKinds(items: DataTransferItemList): ClipboardItemKind[] {
  const kinds: ClipboardItemKind[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    if (item.kind === "file" && findFirstImageItem([item])) kinds.push("file");
    else if (item.kind === "string" && item.type === SVG_MIME_TYPE) kinds.push("svg-mime");
    else if (item.kind === "string" && item.type === "text/plain") kinds.push("text-plain");
  }
  return kinds;
}

/** Handles pasted SVG markup, either as an explicit `image/svg+xml` clipboard item or plain text that sniffs as SVG. */
function tryPasteSvgText(items: DataTransferItemList, options: ScenePresentOptions): void {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== "string" || (item.type !== "text/plain" && item.type !== SVG_MIME_TYPE)) continue;
    item.getAsString((text) => {
      if (!looksLikeSvgMarkup(text)) return;
      insertImageFile({
        scene: options.scene,
        bytes: svgMarkupToBytes(text),
        mimeType: SVG_MIME_TYPE,
        decodeNaturalSize: options.decodeNaturalSize,
        position: viewportCenter(options),
        maxFitSize: options.getViewportSize(),
        maxFileSizeBytes: options.maxFileSizeBytes,
      }).catch((error: unknown) => options.onInsertError?.(error));
    });
    return;
  }
}

export function usePasteAndDrop(options: UsePasteAndDropOptions): void {
  const { containerRef, scene, getCamera, getViewportSize, decodeNaturalSize, maxFileSizeBytes, onInsertError } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !scene) return;
    // Narrowed copy (non-null `scene`) so the module-level helper functions below — typed against
    // the full `UsePasteAndDropOptions` shape, `scene` included — never have to re-check what this
    // guard just established.
    const narrowedOptions: UsePasteAndDropOptions & { scene: Scene } = { ...options, scene };

    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      // Decided synchronously, before any async clipboard read — see `shouldConsumePaste`'s doc and
      // this module's "Paste target guard" note for the race this closes.
      const activeElement = document.activeElement;
      const activeElementTag = activeElement?.tagName ?? null;
      const isContentEditable = activeElement instanceof HTMLElement && activeElement.isContentEditable;
      if (!shouldConsumePaste(activeElementTag, isContentEditable, collectClipboardItemKinds(items))) return;

      event.preventDefault();
      if (tryPasteImageFile(items, narrowedOptions)) return;
      tryPasteSvgText(items, narrowedOptions);
    };

    const handleDragOver = (event: DragEvent) => event.preventDefault();

    const handleDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const dropPoint = screenToScene({ x: event.clientX - rect.left, y: event.clientY - rect.top }, getCamera());

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (!file || !findFirstImageItem([file])) continue;
        insertBlobAt(file, dropPoint, narrowedOptions).catch((error: unknown) => narrowedOptions.onInsertError?.(error));
        return; // one image per drop keeps "single insert point" semantics simple — YAGNI beyond that for V1
      }
    };

    window.addEventListener("paste", handlePaste);
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("paste", handlePaste);
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
    };
  }, [containerRef, scene, getCamera, getViewportSize, decodeNaturalSize, maxFileSizeBytes, onInsertError]);
}
