import { describe, expect, it } from "vitest";
import {
  createArrowElement,
  createDiamondElement,
  createEllipseElement,
  createFreedrawElement,
  createImageElement,
  createRectangleElement,
  createTextElement,
} from "@deviva-draw/engine";
import type { AnyElement, ArrowElement } from "@deviva-draw/engine";
import { toCanvasShapeInput } from "./to-canvas-shape-input";

/** Rebuilds a factory-created element with an explicit, readable id for fixtures/assertions. */
function withId<T extends AnyElement>(element: T, id: string): T {
  return { ...element, id };
}

function rectangle(id: string, overrides: { groupIds?: string[]; isDeleted?: boolean } = {}) {
  return withId({ ...createRectangleElement({ x: 0, y: 0, width: 100, height: 60 }), ...overrides }, id);
}

function boundText(id: string, containerId: string, text: string) {
  return withId(createTextElement({ x: 0, y: 0, text, containerId }), id);
}

function arrow(id: string, startId: string, endId: string, overrides: Partial<ArrowElement> = {}) {
  return withId(
    createArrowElement({
      x: 0,
      y: 0,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      startBinding: { elementId: startId, focus: 0, gap: 4 },
      endBinding: { elementId: endId, focus: 0, gap: 4 },
      ...overrides,
    }),
    id,
  );
}

describe("toCanvasShapeInput", () => {
  it("maps every GEO_KINDS-recognized shape type through verbatim (rectangle/ellipse/diamond)", () => {
    const scene = [
      withId(createRectangleElement({ x: 0, y: 0 }), "shape:rect"),
      withId(createEllipseElement({ x: 0, y: 0 }), "shape:ellipse"),
      withId(createDiamondElement({ x: 0, y: 0 }), "shape:diamond"),
    ];

    const { shapes } = toCanvasShapeInput(scene);

    expect(shapes.map((s) => ({ type: s.type, geo: s.props.geo }))).toEqual([
      { type: "geo", geo: "rectangle" },
      { type: "geo", geo: "ellipse" },
      { type: "geo", geo: "diamond" },
    ]);
  });

  it("folds a bound-text label into its container and never lists the label as its own shape", () => {
    const scene = [rectangle("shape:api"), boundText("text:1", "shape:api", "API gateway")];

    const { shapes } = toCanvasShapeInput(scene);

    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ id: "shape:api", type: "geo", props: { geo: "rectangle", text: "API gateway" } });
  });

  it("keeps standalone text (no containerId) as its own shape", () => {
    const scene = [withId(createTextElement({ x: 0, y: 0, text: "Client" }), "text:standalone")];

    const { shapes } = toCanvasShapeInput(scene);

    expect(shapes).toEqual([{ id: "text:standalone", parentId: "page", type: "text", props: { text: "Client" } }]);
  });

  it("maps an arrow's start/end bindings to CanvasArrowBindingInput and folds its bound label", () => {
    const scene = [rectangle("shape:a"), rectangle("shape:b"), arrow("shape:arrow1", "shape:a", "shape:b"), boundText("text:label", "shape:arrow1", "HTTPS")];

    const { shapes, bindings } = toCanvasShapeInput(scene);

    const arrowShape = shapes.find((s) => s.id === "shape:arrow1");
    expect(arrowShape).toMatchObject({ type: "arrow", props: { text: "HTTPS" } });
    expect(bindings).toEqual([
      { fromId: "shape:arrow1", toId: "shape:a", terminal: "start" },
      { fromId: "shape:arrow1", toId: "shape:b", terminal: "end" },
    ]);
  });

  it('uses the exact string "none" for an arrowhead-less end, matching the extractor\'s isArrowhead() check', () => {
    const scene = [arrow("shape:arrow1", "shape:a", "shape:b", { startArrowhead: "none", endArrowhead: "arrow" })];

    const { shapes } = toCanvasShapeInput(scene);

    expect(shapes[0]?.props.arrowheadStart).toBe("none");
    expect(shapes[0]?.props.arrowheadEnd).toBe("arrow");
  });

  it('never surfaces groupIds as parentId (always "page"), even for a Cmd+G-grouped element with a realistic, disjoint group id', () => {
    // `groupIds` lives in its own id space (not a kept shape's own `id`), so a host's extractor
    // (which only resolves `parentId` against another shape's `id`) would never recognize it as a
    // parent anyway — this is deliberate, not a gap, see the module doc.
    const scene = [rectangle("shape:grouped", { groupIds: ["grp_8f3a1c2e"] }), rectangle("shape:ungrouped")];

    const { shapes } = toCanvasShapeInput(scene);

    expect(shapes.find((s) => s.id === "shape:grouped")?.parentId).toBe("page");
    expect(shapes.find((s) => s.id === "shape:ungrouped")?.parentId).toBe("page");
  });

  it("passes freedraw and image elements through under their own type, contributing no bindings", () => {
    const scene = [
      withId(createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]] }), "mark:scribble"),
      withId(createImageElement({ x: 0, y: 0, fileId: "file:1", naturalWidth: 10, naturalHeight: 10 }), "mark:image"),
    ];

    const { shapes, bindings } = toCanvasShapeInput(scene);

    expect(shapes.map((s) => s.type)).toEqual(["freedraw", "image"]);
    expect(bindings).toEqual([]);
  });

  it("filters out soft-deleted elements entirely", () => {
    const scene = [rectangle("shape:live"), rectangle("shape:gone", { isDeleted: true })];

    const { shapes } = toCanvasShapeInput(scene);

    expect(shapes.map((s) => s.id)).toEqual(["shape:live"]);
  });

  it("omits an unbound arrow end from bindings rather than inventing a connection", () => {
    const scene = [
      rectangle("shape:a"),
      withId(
        createArrowElement({
          x: 0,
          y: 0,
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
          ],
          startBinding: { elementId: "shape:a", focus: 0, gap: 4 },
          endBinding: null,
        }),
        "shape:loose",
      ),
    ];

    const { bindings } = toCanvasShapeInput(scene);

    expect(bindings).toEqual([{ fromId: "shape:loose", toId: "shape:a", terminal: "start" }]);
  });
});
