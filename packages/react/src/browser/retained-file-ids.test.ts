import { describe, expect, it } from "vitest";
import { retainedFileIds } from "./retained-file-ids";

/** A `Storage` over a plain map — enough for the two keys this reads. */
function fakeStorage(entries: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const imageElement = (fileId: string) => ({ id: `e-${fileId}`, type: "image", fileId });

function libraryWith(fileIds: string[]): string {
  return JSON.stringify([{ id: "item", name: "Item", preview: "data:,", created: 0, elements: fileIds.map(imageElement) }]);
}

describe("retainedFileIds", () => {
  it("finds nothing in empty storage", () => {
    expect(retainedFileIds("devivadraw:autosave:v1", fakeStorage()).size).toBe(0);
  });

  it("keeps every image a library item uses", () => {
    const storage = fakeStorage({ "devivadraw:library:v1": libraryWith(["a", "b"]) });

    expect([...retainedFileIds("devivadraw:autosave:v1", storage)].sort()).toEqual(["a", "b"]);
  });

  // The recovery slot is a manual escape hatch nothing reads programmatically. Collecting its images
  // would leave it naming files that exist nowhere — a rescue meant to lose nothing, losing pictures.
  it("keeps images named by the crash-recovery backup, in both envelopes", () => {
    const multiPage = fakeStorage({
      "devivadraw:autosave:v1:recovery": JSON.stringify({ pages: [{ scene: { elements: [imageElement("kept")] } }] }),
    });
    const legacy = fakeStorage({
      "devivadraw:autosave:v1:recovery": JSON.stringify({ elements: [imageElement("legacy-kept")] }),
    });

    expect([...retainedFileIds("devivadraw:autosave:v1", multiPage)]).toEqual(["kept"]);
    expect([...retainedFileIds("devivadraw:autosave:v1", legacy)]).toEqual(["legacy-kept"]);
  });

  it("follows the storage key it is given, so a scoped instance reads its own backup", () => {
    const storage = fakeStorage({ "board-42:recovery": JSON.stringify({ elements: [imageElement("scoped")] }) });

    expect([...retainedFileIds("board-42", storage)]).toEqual(["scoped"]);
    expect(retainedFileIds("devivadraw:autosave:v1", storage).size).toBe(0);
  });

  it("unions both sources", () => {
    const storage = fakeStorage({
      "devivadraw:library:v1": libraryWith(["from-library"]),
      "devivadraw:autosave:v1:recovery": JSON.stringify({ elements: [imageElement("from-recovery")] }),
    });

    expect([...retainedFileIds("devivadraw:autosave:v1", storage)].sort()).toEqual(["from-library", "from-recovery"]);
  });

  // It parses a payload already known to be damaged — that is the only reason the slot exists — so
  // anything unexpected has to read as "no ids", never as a throw on the boot path.
  it("survives a recovery payload that is not what it claims to be", () => {
    for (const raw of ["not json at all", "null", "[]", '{"pages":"nope"}', '{"elements":[null,{"type":"image"},{"type":"image","fileId":7}]}']) {
      const storage = fakeStorage({ "devivadraw:autosave:v1:recovery": raw });
      expect(() => retainedFileIds("devivadraw:autosave:v1", storage)).not.toThrow();
      expect(retainedFileIds("devivadraw:autosave:v1", storage).size).toBe(0);
    }
  });
});
