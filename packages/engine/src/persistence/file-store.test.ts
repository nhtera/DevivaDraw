import { describe, expect, it } from "vitest";
import { createImageElement } from "../elements/image-element";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { collectSceneFiles, referencedFileIds } from "./file-store";
import type { StoredFile } from "../images/files-map";

function storedFile(dataURL: string): StoredFile {
  return { mimeType: "image/png", dataURL, createdAt: 1 };
}

/** A scene holding one image element plus its bytes — the normal state after a paste. */
function sceneWithImage(fileId: string): Scene {
  const scene = new Scene();
  scene.restoreFile(fileId, storedFile(`data:image/png;base64,${fileId}`));
  scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId, naturalWidth: 10, naturalHeight: 10 }));
  return scene;
}

describe("referencedFileIds", () => {
  it("collects across every page", () => {
    expect(referencedFileIds([sceneWithImage("a"), sceneWithImage("b")])).toEqual(new Set(["a", "b"]));
  });

  it("ignores scenes with no images", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));

    expect(referencedFileIds([scene]).size).toBe(0);
  });

  // The whole reason the keep-set is computed from elements rather than from what's on screen: a
  // deleted image is one undo away from being visible again, and collecting its bytes in the meantime
  // would make that undo restore a broken image.
  it("still counts a file referenced only by a soft-deleted element", () => {
    const scene = sceneWithImage("a");
    scene.deleteElement(scene.getElements()[0]!.id);

    expect(referencedFileIds([scene])).toEqual(new Set(["a"]));
  });
});

describe("collectSceneFiles", () => {
  it("returns the bytes of every referenced file", () => {
    const pending = collectSceneFiles([sceneWithImage("a")], new Set());

    expect(pending.get("a")?.dataURL).toBe("data:image/png;base64,a");
  });

  // Content-addressed ids are what make this safe: the same id can never mean different bytes, so a
  // file written once never needs writing again — which is what stops every autosave tick from
  // re-writing a multi-megabyte image.
  it("skips files already persisted", () => {
    expect(collectSceneFiles([sceneWithImage("a")], new Set(["a"])).size).toBe(0);
  });

  it("collects from several pages at once, deduplicating a file two pages share", () => {
    const pending = collectSceneFiles([sceneWithImage("a"), sceneWithImage("a"), sceneWithImage("b")], new Set());

    expect([...pending.keys()].sort()).toEqual(["a", "b"]);
  });

  // The state of an image whose bytes have not been read back from the store yet. Reporting it as
  // pending would write an entry with no payload over the real one — a slow load turned into loss.
  it("skips a referenced id whose bytes the scene does not have", () => {
    const scene = new Scene();
    scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "not-loaded", naturalWidth: 10, naturalHeight: 10 }));

    expect(collectSceneFiles([scene], new Set()).size).toBe(0);
  });
});
