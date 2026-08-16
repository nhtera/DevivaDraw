import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserFileOperations } from "./file-operations-provider";

/**
 * Parity contract for the path-less browser default: it must behave exactly like the legacy
 * picker/save adapters it wraps — same File System Access API branch, same cancel semantics —
 * while adding the provider seam's identity shape (`path: null`, the file's own `name`).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWindow(overrides: Record<string, unknown>) {
  vi.stubGlobal("window", { ...overrides });
}

describe("createBrowserFileOperations", () => {
  it("pickFile returns the picked file's name and text with a null path (File System Access branch)", async () => {
    const getFile = vi.fn().mockResolvedValue({ name: "board.devivadraw", text: () => Promise.resolve('{"a":1}') });
    const showOpenFilePicker = vi.fn().mockResolvedValue([{ getFile }]);
    stubWindow({ showOpenFilePicker });

    const provider = createBrowserFileOperations();
    const opened = await provider.pickFile([".devivadraw", ".excalidraw"]);

    expect(opened).toEqual({ path: null, name: "board.devivadraw", text: '{"a":1}' });
    // The native dialog wants extensions as an array (see pickAndReadFileEntry's doc).
    expect(showOpenFilePicker).toHaveBeenCalledWith({ types: [{ description: "Deviva Draw scene", accept: { "application/json": [".devivadraw", ".excalidraw"] } }] });
  });

  it("pickFile resolves null when the user cancels the native picker", async () => {
    stubWindow({ showOpenFilePicker: vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")) });
    const provider = createBrowserFileOperations();
    await expect(provider.pickFile([".devivadraw"])).resolves.toBeNull();
  });

  it("pickSavePath hands back the suggested name as a virtual path", async () => {
    stubWindow({});
    const provider = createBrowserFileOperations();
    await expect(provider.pickSavePath("scene.devivadraw", [".devivadraw"])).resolves.toBe("scene.devivadraw");
  });

  it("writeFile routes through the File System Access save dialog with the virtual path as the suggested name", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable: () => Promise.resolve({ write, close }) });
    stubWindow({ showSaveFilePicker });

    const provider = createBrowserFileOperations();
    await provider.writeFile("scene.devivadraw", '{"pages":[]}');

    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "scene.devivadraw" }));
    expect(write).toHaveBeenCalledWith('{"pages":[]}');
    expect(close).toHaveBeenCalled();
  });

  it("has no watchFile — nothing to watch in a path-less host", () => {
    expect(createBrowserFileOperations().watchFile).toBeUndefined();
  });
});
