import { afterEach, describe, expect, it, vi } from "vitest";
import { Scene } from "@deviva-draw/engine";
import { createRectangleElement } from "@deviva-draw/engine";
import type { FileOperationsProvider } from "../browser/file-operations-provider";
import { buildPersistenceOperations } from "./build-persistence-operations";
import type { BuildPersistenceOperationsDeps, PagesPersistenceAdapter } from "./build-persistence-operations";

/**
 * The provider seam's branching contract: `fileOperations` present routes open/save through the
 * provider (surfacing file identity), absent leaves the legacy browser paths in charge — the exact
 * regression boundary the desktop phase added.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function sceneDocumentText(): string {
  const scene = new Scene();
  scene.addElement(createRectangleElement({ x: 10, y: 10 }));
  return JSON.stringify(scene.toJSON());
}

function makeProvider(overrides: Partial<FileOperationsProvider> = {}): FileOperationsProvider {
  return {
    pickFile: vi.fn().mockResolvedValue({ path: "/tmp/board.devivadraw", name: "board.devivadraw", text: sceneDocumentText() }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    pickSavePath: vi.fn().mockResolvedValue("/tmp/chosen.devivadraw"),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<BuildPersistenceOperationsDeps> = {}): BuildPersistenceOperationsDeps & { identitySpy: ReturnType<typeof vi.fn> } {
  const identitySpy = vi.fn();
  const scene = new Scene();
  return {
    getScene: () => scene,
    history: { undo: () => null, redo: () => null, push: () => {}, clear: () => {} } as never,
    selection: { clear: () => {}, getSelectedIds: () => new Set<string>() } as never,
    onSceneReplaced: vi.fn(),
    onFileIdentity: identitySpy,
    identitySpy,
    ...overrides,
  };
}

function makePages(): PagesPersistenceAdapter & { replaced: ReturnType<typeof vi.fn> } {
  const replaced = vi.fn();
  const scene = new Scene();
  return {
    getDocument: () => ({ type: "devivadraw/document", schemaVersion: 1, pages: [{ id: "p1", name: "Page 1", scene: scene.toJSON() }] }),
    replaceDocument: replaced,
    replaced,
  };
}

describe("buildPersistenceOperations — provider branching", () => {
  it("openScene with a provider loads the picked file into pages and surfaces the file identity", async () => {
    const provider = makeProvider();
    const pages = makePages();
    const deps = makeDeps({ fileOperations: provider, pages });

    await buildPersistenceOperations(deps).openScene();

    expect(provider.pickFile).toHaveBeenCalledWith([".devivadraw", ".excalidraw"]);
    expect(pages.replaced).toHaveBeenCalledTimes(1);
    expect(deps.identitySpy).toHaveBeenCalledWith({ path: "/tmp/board.devivadraw", name: "board.devivadraw" });
  });

  it("openScene provider cancel is a silent no-op (no replace, no identity)", async () => {
    const provider = makeProvider({ pickFile: vi.fn().mockResolvedValue(null) });
    const pages = makePages();
    const deps = makeDeps({ fileOperations: provider, pages });

    await buildPersistenceOperations(deps).openScene();

    expect(pages.replaced).not.toHaveBeenCalled();
    expect(deps.identitySpy).not.toHaveBeenCalled();
  });

  it("openScene without pages collapses the opened document to its first page via onSceneReplaced", async () => {
    const provider = makeProvider();
    const deps = makeDeps({ fileOperations: provider });

    await buildPersistenceOperations(deps).openScene();

    expect(deps.onSceneReplaced).toHaveBeenCalledTimes(1);
    expect(deps.identitySpy).toHaveBeenCalledWith({ path: "/tmp/board.devivadraw", name: "board.devivadraw" });
  });

  it("saveScene with a provider and no stored path runs Save-As, writes, and surfaces the chosen path", async () => {
    const provider = makeProvider();
    const pages = makePages();
    const deps = makeDeps({ fileOperations: provider, pages, getFilePath: () => null });

    await buildPersistenceOperations(deps).saveScene();

    expect(provider.pickSavePath).toHaveBeenCalledWith("scene.devivadraw", [".devivadraw"]);
    expect(provider.writeFile).toHaveBeenCalledWith("/tmp/chosen.devivadraw", expect.stringContaining("devivadraw/document"));
    expect(deps.identitySpy).toHaveBeenCalledWith({ path: "/tmp/chosen.devivadraw", name: "chosen.devivadraw" });
  });

  it("saveScene with a stored path writes in place without a dialog", async () => {
    const provider = makeProvider();
    const pages = makePages();
    const deps = makeDeps({ fileOperations: provider, pages, getFilePath: () => "/tmp/existing.devivadraw" });

    await buildPersistenceOperations(deps).saveScene();

    expect(provider.pickSavePath).not.toHaveBeenCalled();
    expect(provider.writeFile).toHaveBeenCalledWith("/tmp/existing.devivadraw", expect.any(String));
  });

  it("saveScene Save-As cancel writes nothing and keeps identity untouched", async () => {
    const provider = makeProvider({ pickSavePath: vi.fn().mockResolvedValue(null) });
    const pages = makePages();
    const deps = makeDeps({ fileOperations: provider, pages, getFilePath: () => null });

    await buildPersistenceOperations(deps).saveScene();

    expect(provider.writeFile).not.toHaveBeenCalled();
    expect(deps.identitySpy).not.toHaveBeenCalled();
  });

  it("saveScene with a provider but no pages still saves through the provider (single-scene document)", async () => {
    const provider = makeProvider();
    const deps = makeDeps({ fileOperations: provider, getFilePath: () => null });

    await buildPersistenceOperations(deps).saveScene();

    expect(provider.writeFile).toHaveBeenCalledWith("/tmp/chosen.devivadraw", expect.stringContaining("devivadraw/scene"));
  });

  it("without a provider, open/save never touch provider machinery (legacy browser path)", async () => {
    // The legacy path calls window pickers — stub a canceling picker so the call is observable.
    const showOpenFilePicker = vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError"));
    vi.stubGlobal("window", { showOpenFilePicker });
    const pages = makePages();
    const deps = makeDeps({ pages });

    await buildPersistenceOperations(deps).openScene();

    expect(showOpenFilePicker).toHaveBeenCalledTimes(1);
    expect(deps.identitySpy).not.toHaveBeenCalled();
  });
});

describe("buildPersistenceOperations — browser (no provider) save error handling", () => {
  it("a throwing browser save is reported, never an unhandled rejection", async () => {
    // FS Access path present and rejecting — the picker throwing (e.g. write failure) must be
    // caught and funneled to onError, exactly like the pre-seam behavior.
    const showSaveFilePicker = vi.fn().mockRejectedValue(new Error("disk full"));
    vi.stubGlobal("window", { showSaveFilePicker });
    const onError = vi.fn();
    const pages = makePages();
    const deps = makeDeps({ pages, onError });

    await expect(buildPersistenceOperations(deps).saveScene()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

/**
 * The load gate. A document restored from storage carries `fileId` references before it carries the
 * images themselves (see `restore-document-files.ts`), so anything that turns the scene into bytes
 * has to wait — otherwise a save or export fired in the first milliseconds after boot writes blank
 * images. `whenFilesReady` is also re-exported on the operations object so the export dialog, which
 * renders directly rather than through these actions, can wait on the same promise.
 */
describe("buildPersistenceOperations — waiting for image data", () => {
  /** A gate that stays shut until released, so "did it wait?" is observable rather than a race. */
  function pendingGate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { whenFilesReady: () => promise, release };
  }

  it("saves nothing until the images are back", async () => {
    const gate = pendingGate();
    const provider = makeProvider();
    const operations = buildPersistenceOperations(makeDeps({ fileOperations: provider, pages: makePages(), whenFilesReady: gate.whenFilesReady }));

    const saving = operations.saveSceneOutcome!();
    await Promise.resolve();
    expect(provider.writeFile).not.toHaveBeenCalled();

    gate.release();
    await saving;
    expect(provider.writeFile).toHaveBeenCalledTimes(1);
  });

  it("exposes the same gate for callers that render the scene themselves", async () => {
    const gate = pendingGate();
    const operations = buildPersistenceOperations(makeDeps({ whenFilesReady: gate.whenFilesReady }));
    let ready = false;
    void operations.whenFilesReady().then(() => {
      ready = true;
    });

    await Promise.resolve();
    expect(ready).toBe(false);

    gate.release();
    await operations.whenFilesReady();
    expect(ready).toBe(true);
  });

  it("resolves immediately when the host has nothing to wait for", async () => {
    const operations = buildPersistenceOperations(makeDeps());
    await expect(operations.whenFilesReady()).resolves.toBeUndefined();
  });
});
