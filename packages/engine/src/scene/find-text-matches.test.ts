import { describe, expect, it } from "vitest";
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
});
