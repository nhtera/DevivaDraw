import rough from "roughjs";
import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createImageElement } from "../elements/image-element";
import { createDiamondElement, createEllipseElement, createLineElement, createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { serializeScene } from "../persistence/serialize-scene";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import { Scene } from "../scene/scene";
import { EmptyExportSelectionError } from "./export-geometry";
import { exportToSvg, readEmbeddedSceneDataFromSvg } from "./export-to-svg";
import type { ExportToSvgOptions } from "./export-to-svg";

/** Real (headless) rough.js generator — no `<canvas>`/DOM needed for SVG-mode path generation, and using the genuine implementation (not a mock) exercises the actual `toPaths()` integration the spec calls for. */
function baseOptions(scene: Scene): ExportToSvgOptions {
  return { scene, roughGenerator: rough.generator(), textMeasurer: createFixedWidthTextMeasurer(6) };
}

describe("exportToSvg — document structure", () => {
  it("produces a standalone <svg> document with matching width/height/viewBox", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const svg = exportToSvg({ ...baseOptions(scene), padding: 0 });

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("scales the output dimensions by the requested scale factor", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const svg = exportToSvg({ ...baseOptions(scene), padding: 0, scale: 2 });
    expect(svg).toContain('width="200" height="100"');
  });

  it("throws EmptyExportSelectionError for an empty scene", () => {
    expect(() => exportToSvg(baseOptions(new Scene()))).toThrow(EmptyExportSelectionError);
  });

  it("is deterministic: two exports of the same unchanged scene produce byte-identical SVG strings", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 30, roughness: 2 }));
    scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 20, y: 20 }] }));
    const first = exportToSvg(baseOptions(scene));
    const second = exportToSvg(baseOptions(scene));
    expect(first).toBe(second);
  });
});

describe("exportToSvg — per-element-type markup", () => {
  it("rectangle/ellipse/diamond/line render as rough.js <path> elements with the element's stroke color", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, strokeColor: "#ff0000" }));
    scene.addElement(createEllipseElement({ x: 30, y: 0, width: 20, height: 20 }));
    scene.addElement(createDiamondElement({ x: 60, y: 0, width: 20, height: 20 }));
    scene.addElement(createLineElement({ x: 90, y: 0, points: [{ x: 0, y: 0 }, { x: 20, y: 20 }] }));

    const svg = exportToSvg(baseOptions(scene));
    expect(svg).toContain("<path");
    expect(svg).toContain('stroke="#ff0000"');
  });

  it("arrow renders as multiple <path> elements (shaft + arrowhead)", () => {
    const scene = new Scene();
    scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }], endArrowhead: "arrow" }));
    const svg = exportToSvg(baseOptions(scene));
    const pathCount = svg.match(/<path/g)?.length ?? 0;
    expect(pathCount).toBeGreaterThanOrEqual(2); // shaft + default end chevron
  });

  it("freedraw renders as one filled <path> using the stroke color as fill, with no stroke", () => {
    const scene = new Scene();
    scene.addElement(
      createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5], [5, 0, 0.5], [5, 5, 0.5]], strokeColor: "#00ff00" }),
    );
    const svg = exportToSvg(baseOptions(scene));
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).toContain('stroke="none"');
  });

  it("text renders as one <text> element per wrapped line, escaping XSS-adjacent content", () => {
    const scene = new Scene();
    scene.addElement(createTextElement({ x: 0, y: 0, text: "<script>alert(1)</script>" }));
    const svg = exportToSvg(baseOptions(scene));

    expect(svg).toContain("<text");
    expect(svg).not.toContain("<script>alert(1)</script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("image with a resolvable file renders as an <image> with the file's dataURL embedded", () => {
    const scene = new Scene();
    scene.addFile("f1", { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", createdAt: 1 });
    scene.addElement(createImageElement({ x: 0, y: 0, width: 20, height: 20, fileId: "f1", naturalWidth: 20, naturalHeight: 20 }));

    const svg = exportToSvg(baseOptions(scene));
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png;base64,AAAA");
  });

  it("image with a missing file renders a placeholder <rect> instead of <image>", () => {
    const scene = new Scene();
    scene.addElement(createImageElement({ x: 0, y: 0, width: 20, height: 20, fileId: "missing", naturalWidth: 20, naturalHeight: 20 }));

    const svg = exportToSvg(baseOptions(scene));
    expect(svg).not.toContain("<image");
    expect(svg).toContain("<rect");
  });

  it("wraps a rotated element in a <g transform=\"rotate(...)\"> group", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, angle: Math.PI / 2 }));
    const svg = exportToSvg(baseOptions(scene));
    expect(svg).toMatch(/<g opacity="1" transform="rotate\(90 /);
  });

  it("applies the element's opacity as a <g> attribute", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, opacity: 50 }));
    const svg = exportToSvg(baseOptions(scene));
    expect(svg).toContain('<g opacity="0.5">');
  });
});

describe("exportToSvg — background + embedded scene data", () => {
  it("includes a background <rect> when backgroundColor is provided, omits it otherwise", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20 }));

    const withBg = exportToSvg({ ...baseOptions(scene), backgroundColor: "#000000" });
    expect(withBg).toContain('fill="#000000"');

    const withoutBg = exportToSvg(baseOptions(scene));
    expect(withoutBg).not.toContain("#000000");
  });

  it("embeds the live scene JSON in a <metadata> block by default, recoverable via readEmbeddedSceneDataFromSvg", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20 }));
    const svg = exportToSvg(baseOptions(scene));

    const embedded = readEmbeddedSceneDataFromSvg(svg);
    expect(embedded).not.toBeNull();
    expect(JSON.parse(embedded!)).toEqual(serializeScene(scene));
  });

  it("omits <metadata> when embedSceneData is false", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20 }));
    const svg = exportToSvg({ ...baseOptions(scene), embedSceneData: false });

    expect(svg).not.toContain("<metadata>");
    expect(readEmbeddedSceneDataFromSvg(svg)).toBeNull();
  });

  it("only exports the given selection subset when elements is provided", () => {
    const scene = new Scene();
    const selected = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20 }));
    scene.addElement(createRectangleElement({ x: 500, y: 500, width: 20, height: 20 }));

    const svg = exportToSvg({ ...baseOptions(scene), elements: [selected], padding: 0 });
    expect(svg).toContain('width="20" height="20"');
  });
});

describe("exportToSvg — table elements", () => {
  it("emits the rough grid path, per-line clipped <text>, and XML-escaped cell content", async () => {
    const { createTableElement } = await import("../elements/table-element");
    const scene = new Scene();
    scene.addElement(
      createTableElement({ x: 0, y: 0, columnWidths: [100, 100], rowHeights: [40], cells: [["a & <b>", "second"]] }),
    );
    const svg = exportToSvg({ ...baseOptions(scene), padding: 0, embedSceneData: false });

    expect(svg).toContain("<path"); // the rough grid drawable
    expect(svg).toContain("a &amp; &lt;b&gt;"); // escaped, never raw
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("second");
    expect(svg).toContain("clip-path=");
    expect((svg.match(/<clipPath /g) ?? []).length).toBe(2); // one clip per non-empty cell
  });

  it("wrapped cell text exports one <text> per line, matching the scene-size wrap", async () => {
    const { createTableElement } = await import("../elements/table-element");
    const scene = new Scene();
    // Fixed-width measurer at 6px/char, wrap width 100-12=88 → 14 chars per line; 28 chars = 2 lines.
    scene.addElement(createTableElement({ x: 0, y: 0, columnWidths: [100], rowHeights: [40], cells: [["x".repeat(28)]] }));
    const svg = exportToSvg({ ...baseOptions(scene), padding: 0, embedSceneData: false });
    expect((svg.match(/<text /g) ?? []).length).toBe(2);
  });
});

describe("exportToSvg — hostile element id (collab-controlled) never reaches markup raw", () => {
  it("strips attribute-breakout characters from the clip-path id", async () => {
    const { createTableElement } = await import("../elements/table-element");
    const scene = new Scene();
    const table = createTableElement({ x: 0, y: 0, columnWidths: [100], rowHeights: [40], cells: [["cell"]] });
    const hostileId = 'x"/><image href=x onerror=alert(1)/><rect id="x';
    scene.addElement({ ...table, id: hostileId });
    const svg = exportToSvg({ ...baseOptions(scene), padding: 0, embedSceneData: false });
    // The letters survive; the markup does not — no attribute breakout, no injected elements.
    expect(svg).not.toContain("onerror=");
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain(hostileId);
    expect(svg).toContain('clipPath id="table-cell-ximagehrefxonerroralert1rectidx-0-0"');
  });
});
