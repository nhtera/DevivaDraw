/**
 * The seam version history takes its snapshots through.
 *
 * The property under test is not "it returns a document" — it is that the document it returns has
 * *the same file exclusions the autosave write would have made*. That equality is the entire reason
 * `snapshotDocument` exists on the controller instead of version history serialising the page store
 * itself: the exclusion set lives in a closure local (`autosave-file-offload.ts`), and a snapshot
 * built from a different one would either carry megabytes of pixels it was supposed to leave behind,
 * or name file ids nothing has accepted yet — a stored version that restores with broken images.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageElement } from "@deviva-draw/engine";
import type { FileStoreLike, StoredFile } from "@deviva-draw/engine";
import { PageStore } from "../pages/page-store";
import { startBrowserDocumentAutosave } from "./scene-file-operations";

function memoryLocalStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
}

/** An in-memory `FileStoreLike` whose acceptance can be held open, so the pre-offload window is reachable in a test. */
function holdableFileStore() {
  const held = new Map<string, StoredFile>();
  let release: (() => void) | null = null;
  const store: FileStoreLike = {
    getMany: (ids) => Promise.resolve(new Map(ids.filter((id) => held.has(id)).map((id) => [id, held.get(id)!]))),
    putMany: (entries) =>
      new Promise<void>((resolve) => {
        release = () => {
          for (const [id, file] of entries) held.set(id, file);
          resolve();
        };
      }),
    deleteMany: () => Promise.resolve(),
    listIds: () => Promise.resolve([...held.keys()]),
  };
  // The offload writes on its own schedule (it syncs once the store promise settles), so a test that
  // released synchronously would release before there was anything to release.
  const accept = async () => {
    await vi.waitFor(() => expect(release).not.toBeNull());
    release!();
    release = null;
  };
  return { store, held, accept };
}

const PNG: StoredFile = { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", createdAt: 1 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("DocumentAutosaveController.snapshotDocument", () => {
  it("returns the whole document, deleted elements and all — the autosave shape, not the export shape", () => {
    vi.stubGlobal("window", { localStorage: memoryLocalStorage() });
    const pages = PageStore.fresh();
    const scene = pages.getActiveScene();
    const element = createImageElement({ x: 0, y: 0, width: 10, height: 10, naturalWidth: 10, naturalHeight: 10, fileId: "file-a" });
    scene.addElement(element);
    scene.updateElement(element.id, { isDeleted: true });
    const controller = startBrowserDocumentAutosave(pages, scene);

    const document = controller.snapshotDocument();

    // Present, and marked deleted: undo has to survive a restore the same way it survives a reload.
    expect(document.pages[0]!.scene.elements).toHaveLength(1);
    expect(document.pages[0]!.scene.elements[0]!.isDeleted).toBe(true);
    controller.dispose();
  });

  it("keeps image bytes inline while the file store has not accepted them yet", async () => {
    vi.stubGlobal("window", { localStorage: memoryLocalStorage() });
    const files = holdableFileStore();
    const pages = PageStore.fresh();
    const scene = pages.getActiveScene();
    scene.restoreFile("file-a", PNG);
    scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, naturalWidth: 10, naturalHeight: 10, fileId: "file-a" }));
    const controller = startBrowserDocumentAutosave(pages, scene, undefined, undefined, undefined, undefined, Promise.resolve(files.store));

    // The offload is mid-flight: nothing outside the document holds these bytes, so the snapshot must
    // carry them. A reference here would name a file that exists nowhere.
    const duringOffload = controller.snapshotDocument();
    expect(Object.keys(duringOffload.pages[0]!.scene.files)).toEqual(["file-a"]);

    await files.accept();
    await vi.waitFor(() => expect(files.held.has("file-a")).toBe(true));
    // The store has it now, so the snapshot drops the payload and keeps the reference — the same
    // exclusion the localStorage write makes, from the same source.
    await vi.waitFor(() => expect(Object.keys(controller.snapshotDocument().pages[0]!.scene.files)).toEqual([]));
    expect(controller.snapshotDocument().pages[0]!.scene.elements[0]).toMatchObject({ type: "image", fileId: "file-a" });

    controller.dispose();
  });

  it("excludes exactly what the localStorage write excludes", async () => {
    const storage = memoryLocalStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const files = holdableFileStore();
    const pages = PageStore.fresh();
    const scene = pages.getActiveScene();
    scene.restoreFile("file-a", PNG);
    scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, naturalWidth: 10, naturalHeight: 10, fileId: "file-a" }));
    const controller = startBrowserDocumentAutosave(pages, scene, undefined, undefined, undefined, undefined, Promise.resolve(files.store));
    await files.accept();
    await vi.waitFor(() => expect(files.held.has("file-a")).toBe(true));

    controller.flush();
    const written = JSON.parse([...storage.data.values()].at(-1)!) as { pages: { scene: { files: Record<string, unknown> } }[] };
    const snapshot = controller.snapshotDocument();

    expect(Object.keys(snapshot.pages[0]!.scene.files)).toEqual(Object.keys(written.pages[0]!.scene.files));
    controller.dispose();
  });

  it("leaves the autosave slot's origin marker out — a stored version describes a board, not a file", () => {
    vi.stubGlobal("window", { localStorage: memoryLocalStorage() });
    const pages = PageStore.fresh();
    const controller = startBrowserDocumentAutosave(pages, pages.getActiveScene(), undefined, undefined, () => ({ originPath: "/tmp/somebody.devivadraw", unsaved: true }));

    const document = controller.snapshotDocument();

    expect(document).not.toHaveProperty("originPath");
    expect(document).not.toHaveProperty("unsaved");
    controller.dispose();
  });
});
