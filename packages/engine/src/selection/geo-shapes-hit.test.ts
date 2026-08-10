import { describe, expect, it } from "vitest";
import { createBlockArrowElement, createCloudElement } from "../elements/shape-elements";
import { createNoteElement } from "../elements/note-element";
import { isBindableContainer } from "../text/bound-text";
import { hitTestElement } from "./hit-test";

const TOL = 4;

describe("new geo shape hit testing", () => {
  it("a right block arrow hits its shaft/head but not the empty corner above the shaft", () => {
    const arrow = createBlockArrowElement({ x: 0, y: 0, width: 100, height: 100, direction: "right", backgroundColor: "#f00" });
    expect(hitTestElement(arrow, { x: 90, y: 50 }, TOL)).toBe(true); // in the head
    expect(hitTestElement(arrow, { x: 30, y: 50 }, TOL)).toBe(true); // in the shaft
    expect(hitTestElement(arrow, { x: 30, y: 5 }, TOL)).toBe(false); // above the shaft (empty)
  });

  it("a filled cloud hits its bounding box interior", () => {
    const cloud = createCloudElement({ x: 0, y: 0, width: 100, height: 60, backgroundColor: "#f00" });
    expect(hitTestElement(cloud, { x: 50, y: 30 }, TOL)).toBe(true);
    expect(hitTestElement(cloud, { x: 500, y: 500 }, TOL)).toBe(false);
  });

  it("a note is a bindable container and its whole interior is clickable", () => {
    const note = createNoteElement({ x: 0, y: 0, width: 120, height: 120 });
    expect(isBindableContainer(note)).toBe(true);
    expect(hitTestElement(note, { x: 60, y: 60 }, TOL)).toBe(true); // solid card interior
  });
});
