import { describe, expect, it } from "vitest";
import { createFrameElement } from "../elements/frame-element";
import { createTextElement } from "../elements/text-element";
import { Scene } from "./scene";
import { findTextMatches } from "./find-text-matches";

describe("findTextMatches", () => {
  it("returns ids of text elements whose text contains the query, case-insensitively", () => {
    const scene = new Scene();
    const a = scene.addElement(createTextElement({ x: 0, y: 0, text: "Hello World" }));
    scene.addElement(createTextElement({ x: 0, y: 50, text: "unrelated" }));
    const c = scene.addElement(createTextElement({ x: 0, y: 100, text: "another WORLD here" }));

    expect(findTextMatches(scene, "world")).toEqual([a.id, c.id]);
  });

  it("returns matches in scene draw order", () => {
    const scene = new Scene();
    const first = scene.addElement(createTextElement({ x: 0, y: 0, text: "match one" }));
    const second = scene.addElement(createTextElement({ x: 0, y: 50, text: "match two" }));

    expect(findTextMatches(scene, "match")).toEqual([first.id, second.id]);
  });

  it("skips deleted text and ignores non-text elements", () => {
    const scene = new Scene();
    const live = scene.addElement(createTextElement({ x: 0, y: 0, text: "keep me" }));
    const gone = scene.addElement(createTextElement({ x: 0, y: 50, text: "keep me too" }));
    scene.deleteElement(gone.id);

    expect(findTextMatches(scene, "keep")).toEqual([live.id]);
  });

  it("an empty or whitespace-only query matches nothing", () => {
    const scene = new Scene();
    scene.addElement(createTextElement({ x: 0, y: 0, text: "anything" }));

    expect(findTextMatches(scene, "")).toEqual([]);
    expect(findTextMatches(scene, "   ")).toEqual([]);
  });

  it("matches a frame by its name, which is how a user labels a region", () => {
    const scene = new Scene();
    const pricing = scene.addElement(createFrameElement({ x: 0, y: 0, name: "Pricing slide" }));
    scene.addElement(createFrameElement({ x: 0, y: 300, name: "Roadmap" }));

    expect(findTextMatches(scene, "pricing")).toEqual([pricing.id]);
  });

  it("survives a collab-ingested frame whose name is not a string", () => {
    // `collab-client`'s `isPlausibleRemoteElement` admits an element on its base fields alone, so a
    // peer can land a frame with no `name` at all. Find recomputes on every scene mutation while its
    // panel is open, so this would throw on the next remote edit, not on a keystroke.
    const scene = new Scene();
    const frame = scene.addElement(createFrameElement({ x: 0, y: 0, name: "Pricing slide" }));
    scene.updateElement(frame.id, { name: undefined } as unknown as Partial<typeof frame>);

    expect(() => findTextMatches(scene, "pricing")).not.toThrow();
    expect(findTextMatches(scene, "pricing")).toEqual([]);
  });
});
