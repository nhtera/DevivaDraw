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
