/**
 * The walk that decides which images a stored version keeps alive. Tested harder than its size
 * suggests because a miss here is silent: the snapshot stores fine, collection reclaims the bytes it
 * failed to name, and the failure only appears later as a broken image in a restored board.
 */
import { describe, expect, it } from "vitest";
import { createImageElement, MULTI_PAGE_DOCUMENT_TYPE, Scene, serializeMultiPageDocument } from "@deviva-draw/engine";
import type { AnyElement, MultiPageDocumentV1, SceneDocumentV1 } from "@deviva-draw/engine";
import { summarizeDocument } from "./version-snapshot-summary";

function imageOn(scene: Scene, fileId: string): AnyElement {
  const element = createImageElement({ x: 0, y: 0, width: 10, height: 10, naturalWidth: 10, naturalHeight: 10, fileId });
  scene.addElement(element);
  return scene.getElement(element.id)!;
}

/** A document written the way autosave writes one: deleted elements kept, image payloads excluded. */
function documentOf(scenes: Scene[], excludeFileIds: string[] = []): MultiPageDocumentV1 {
  return serializeMultiPageDocument(
    scenes.map((scene, index) => ({ id: `page-${index}`, name: `Page ${index + 1}`, scene, camera: null })),
    { includeDeleted: true, excludeFileIds: new Set(excludeFileIds) },
  );
}

describe("summarizeDocument", () => {
  it("collects every referenced image across every page, once each", () => {
    const first = new Scene();
    imageOn(first, "file-a");
    imageOn(first, "file-a"); // the same picture placed twice
    const second = new Scene();
    imageOn(second, "file-b");

    const summary = summarizeDocument(documentOf([first, second]));

    expect(summary.fileIds.sort()).toEqual(["file-a", "file-b"]);
    expect(summary.pageCount).toBe(2);
  });

  it("keeps a soft-deleted element's file reference — an undo can bring the element back", () => {
    const scene = new Scene();
    const element = imageOn(scene, "file-a");
    scene.updateElement(element.id, { isDeleted: true });

    const summary = summarizeDocument(documentOf([scene]));

    // Named in the keep-set...
    expect(summary.fileIds).toEqual(["file-a"]);
    // ...but not counted as something on the board.
    expect(summary.elementCount).toBe(0);
  });

  it("finds references even though the document carries no file payloads at all", () => {
    const scene = new Scene();
    scene.restoreFile("file-a", { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", createdAt: 1 });
    imageOn(scene, "file-a");

    const document = documentOf([scene], ["file-a"]);

    // The premise: autosave excluded the bytes, so a `files`-map walk would find nothing.
    expect(Object.keys(document.pages[0]!.scene.files)).toEqual([]);
    expect(summarizeDocument(document).fileIds).toEqual(["file-a"]);
  });

  it("measures the serialised document, not the live scene", () => {
    const empty: MultiPageDocumentV1 = { type: MULTI_PAGE_DOCUMENT_TYPE, schemaVersion: 1, pages: [] };

    expect(summarizeDocument(empty)).toEqual({ fileIds: [], pageCount: 0, elementCount: 0, bytes: JSON.stringify(empty).length });
  });

  it("counts live elements only", () => {
    const scene = new Scene();
    imageOn(scene, "file-a");
    imageOn(scene, "file-b");

    expect(summarizeDocument(documentOf([scene])).elementCount).toBe(2);
  });
});

// A compile-time reminder that this module reads `elements`, never `files` — see its own doc.
export type _ElementsAreTheSource = SceneDocumentV1["elements"];
