import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRectangleElement, MULTI_PAGE_DOCUMENT_TYPE, SCENE_DOCUMENT_TYPE } from "@deviva-draw/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SceneSession } from "./scene-session";
import { ToolError } from "./tools/tool-types";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deviva-mcp-session-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function addRect(session: SceneSession, x = 0, y = 0): string {
  return session.scene.addElement(createRectangleElement({ x, y, width: 100, height: 50 })).id;
}

describe("SceneSession", () => {
  it("starts with one empty page and no bound file", () => {
    const session = new SceneSession();
    expect(session.pageCount).toBe(1);
    expect(session.filePath).toBeNull();
    expect(session.scene.getElements()).toHaveLength(0);
  });

  it("round-trips a single-scene save/open", () => {
    const session = new SceneSession();
    const id = addRect(session, 10, 20);
    const path = join(dir, "scene.devivadraw");
    session.saveScene(path);

    const raw = JSON.parse(readFileSync(path, "utf8")) as { type: string };
    expect(raw.type).toBe(SCENE_DOCUMENT_TYPE);

    const reopened = new SceneSession();
    const result = reopened.openScene(path);
    expect(result.elementCount).toBe(1);
    expect(result.droppedErrors).toEqual([]);
    expect(reopened.scene.getElement(id)?.x).toBe(10);
  });

  it("preserves untouched pages and format when saving a multi-page document", () => {
    const otherPageScene = { type: SCENE_DOCUMENT_TYPE, schemaVersion: 1, elements: [], files: {} };
    const active = createRectangleElement({ x: 1, y: 2, width: 10, height: 10 });
    const doc = {
      type: MULTI_PAGE_DOCUMENT_TYPE,
      schemaVersion: 1,
      activePageId: "p2",
      pages: [
        { id: "p1", name: "First", scene: otherPageScene },
        { id: "p2", name: "Second", scene: { type: SCENE_DOCUMENT_TYPE, schemaVersion: 1, elements: [{ ...active, version: 1, index: "a0" }], files: {} } },
      ],
    };
    const path = join(dir, "doc.devivadraw");
    writeFileSync(path, JSON.stringify(doc));

    const session = new SceneSession();
    const opened = session.openScene(path);
    expect(opened.pageCount).toBe(2);
    expect(opened.activePageName).toBe("Second");
    expect(opened.elementCount).toBe(1);

    addRect(session, 99, 99);
    session.saveScene();

    const saved = JSON.parse(readFileSync(path, "utf8")) as { type: string; activePageId: string; pages: Array<{ id: string; name: string; scene: { elements: unknown[] } }> };
    expect(saved.type).toBe(MULTI_PAGE_DOCUMENT_TYPE);
    expect(saved.activePageId).toBe("p2");
    expect(saved.pages[0]?.name).toBe("First");
    expect(saved.pages[0]?.scene.elements).toHaveLength(0);
    expect(saved.pages[1]?.scene.elements).toHaveLength(2);
  });

  it("salvages a document with an invalid element and reports droppedErrors", () => {
    const good = { ...createRectangleElement({ x: 0, y: 0, width: 5, height: 5 }), version: 1, index: "a0" };
    const doc = { type: SCENE_DOCUMENT_TYPE, schemaVersion: 1, elements: [good, { type: "rectangle", x: "not-a-number" }], files: {} };
    const path = join(dir, "broken.devivadraw");
    writeFileSync(path, JSON.stringify(doc));

    const session = new SceneSession();
    const result = session.openScene(path);
    expect(result.elementCount).toBe(1);
    expect(result.droppedErrors.length).toBeGreaterThan(0);
  });

  it("rejects unreadable, non-JSON, and non-scene files with ToolError", () => {
    const session = new SceneSession();
    expect(() => session.openScene(join(dir, "missing.devivadraw"))).toThrow(ToolError);

    const notJson = join(dir, "not.json");
    writeFileSync(notJson, "hello");
    expect(() => session.openScene(notJson)).toThrow(/not valid JSON/);

    const wrongShape = join(dir, "wrong.json");
    writeFileSync(wrongShape, JSON.stringify({ type: "something-else" }));
    expect(() => session.openScene(wrongShape)).toThrow(/not a readable Deviva Draw file/);
  });

  it("requires a path for the first save and binds it afterward", () => {
    const session = new SceneSession();
    expect(() => session.saveScene()).toThrow(/no file is bound/);
    const path = join(dir, "first.devivadraw");
    session.saveScene(path);
    expect(session.filePath).toBe(path);
    session.saveScene(); // bound now
  });

  it("confines file access to the configured root", () => {
    const session = new SceneSession({ rootDir: dir });
    expect(() => session.saveScene(join(dir, "inside.devivadraw"))).not.toThrow();
    expect(() => session.saveScene(join(tmpdir(), "outside.devivadraw"))).toThrow(/outside the allowed root/);
    // A ../ escape that resolves outside the root is rejected too.
    expect(() => session.openScene(join(dir, "..", "escape.devivadraw"))).toThrow(/outside the allowed root/);
    // Prefix collision: "<root>-evil" shares the root's string prefix but is a sibling, not a child.
    expect(() => session.saveScene(`${dir}-evil/scene.devivadraw`)).toThrow(/outside the allowed root/);
  });

  it("new_scene resets pages, binding, and content", () => {
    const session = new SceneSession();
    addRect(session);
    session.saveScene(join(dir, "bound.devivadraw"));
    session.newScene();
    expect(session.filePath).toBeNull();
    expect(session.scene.getElements()).toHaveLength(0);
    expect(session.pageCount).toBe(1);
  });

  it("lockScene blocks scene swaps (not saves) until unlockScene", () => {
    const session = new SceneSession();
    addRect(session);
    const path = join(dir, "locked.devivadraw");
    session.saveScene(path);

    session.lockScene("the scene is bound to a live session — disconnect first");
    expect(() => session.newScene()).toThrow(/live session/);
    expect(() => session.openScene(path)).toThrow(/live session/);
    // Saving/reading the live scene stays allowed — snapshotting the shared board is a feature.
    expect(() => session.saveScene(path)).not.toThrow();

    session.unlockScene();
    expect(() => session.openScene(path)).not.toThrow();
    expect(() => session.newScene()).not.toThrow();
  });
});
