import { describe, expect, it } from "vitest";
import { exportFramesToPptx, letterbox, slideSizeEmu } from "./export-to-pptx";
import type { PptxSlideInput } from "./export-to-pptx";

const NOW = Date.UTC(2026, 7, 18, 10, 20, 30);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function slide(name: string, width = 1600, height = 900): PptxSlideInput {
  return { name, width, height, png: PNG };
}

/** Part paths + contents, read back through the archive's own central directory. */
function readParts(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.length - 22;
  const count = view.getUint16(endOffset + 10, true);
  let at = view.getUint32(endOffset + 16, true);
  const parts = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    parts.set(name, new TextDecoder().decode(bytes.subarray(dataStart, dataStart + size)));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return parts;
}

describe("exportFramesToPptx", () => {
  it("writes one slide, one rels part and one image per frame, plus the fixed package parts", () => {
    const parts = readParts(exportFramesToPptx({ slides: [slide("Intro"), slide("Results"), slide("End")], now: NOW }));
    for (const path of [
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      "ppt/theme/theme1.xml",
    ]) {
      expect(parts.has(path), `missing ${path}`).toBe(true);
    }
    for (const number of [1, 2, 3]) {
      expect(parts.has(`ppt/slides/slide${number}.xml`)).toBe(true);
      expect(parts.has(`ppt/slides/_rels/slide${number}.xml.rels`)).toBe(true);
      expect(parts.has(`ppt/media/image${number}.png`)).toBe(true);
    }
  });

  it("declares a content type for every part in the archive — the split-consumer failure mode", () => {
    const parts = readParts(exportFramesToPptx({ slides: [slide("A"), slide("B")], now: NOW }));
    const types = parts.get("[Content_Types].xml")!;
    const defaults = new Set([...types.matchAll(/<Default Extension="([^"]+)"/g)].map((match) => match[1]!));
    for (const path of parts.keys()) {
      if (path === "[Content_Types].xml") continue;
      const extension = path.slice(path.lastIndexOf(".") + 1);
      const covered = defaults.has(extension) || types.includes(`PartName="/${path}"`);
      expect(covered, `${path} has no Default or Override content type`).toBe(true);
    }
  });

  it("points every relationship at a part that exists", () => {
    const parts = readParts(exportFramesToPptx({ slides: [slide("A"), slide("B")], now: NOW }));
    for (const [path, content] of parts) {
      if (!path.endsWith(".rels")) continue;
      // A .rels part sits in `<dir>/_rels/<name>.rels` and its targets resolve relative to `<dir>`,
      // which is the empty string for the package-root `_rels/.rels`.
      const base = path.slice(0, path.lastIndexOf("_rels/")).replace(/\/$/, "");
      for (const match of content.matchAll(/Target="([^"]+)"/g)) {
        const resolved = normalize(base === "" ? match[1]! : `${base}/${match[1]!}`);
        expect(parts.has(resolved), `${path} points at missing ${resolved}`).toBe(true);
      }
    }
  });

  it("lists the slides in deck order, each id unique and above the format's floor", () => {
    const parts = readParts(exportFramesToPptx({ slides: [slide("A"), slide("B"), slide("C")], now: NOW }));
    const ids = [...parts.get("ppt/presentation.xml")!.matchAll(/<p:sldId id="(\d+)" r:id="(rId\d+)"\/>/g)];
    expect(ids.map((match) => match[2])).toEqual(["rId2", "rId3", "rId4"]);
    expect(ids.every((match) => Number(match[1]) >= 256)).toBe(true);
    expect(new Set(ids.map((match) => match[1])).size).toBe(3);
  });

  it("takes the deck's slide size from the first frame's aspect", () => {
    const parts = readParts(exportFramesToPptx({ slides: [slide("Wide", 1600, 900)], now: NOW }));
    expect(parts.get("ppt/presentation.xml")).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
  });

  it("falls back to 16:9 when there is no usable aspect to derive from", () => {
    expect(slideSizeEmu(undefined)).toEqual({ cx: 12_192_000, cy: 6_858_000 });
    expect(slideSizeEmu({ width: 0, height: 0 })).toEqual({ cx: 12_192_000, cy: 6_858_000 });
  });

  it("clamps an extreme aspect rather than letting one banner frame flatten the deck", () => {
    expect(slideSizeEmu({ width: 10_000, height: 100 }).cx).toBe(Math.round(6_858_000 * 4));
    expect(slideSizeEmu({ width: 100, height: 10_000 }).cx).toBe(Math.round(6_858_000 * 0.25));
  });

  it("letterboxes a frame that does not match the deck aspect, centered and undistorted", () => {
    const size = { cx: 12_192_000, cy: 6_858_000 };
    const placement = letterbox({ width: 900, height: 900 }, size);
    expect(placement.extent).toEqual({ cx: 6_858_000, cy: 6_858_000 });
    expect(placement.offset).toEqual({ x: (12_192_000 - 6_858_000) / 2, y: 0 });
  });

  it("fills the slide for a degenerate frame instead of dividing by zero", () => {
    expect(letterbox({ width: 0, height: 0 }, { cx: 100, cy: 50 })).toEqual({ offset: { x: 0, y: 0 }, extent: { cx: 100, cy: 50 } });
  });

  it("escapes a frame name so it cannot break out of the shape-name attribute", () => {
    const parts = readParts(exportFramesToPptx({ slides: [slide('Q3 "wins" & <losses>')], now: NOW }));
    const xml = parts.get("ppt/slides/slide1.xml")!;
    expect(xml).toContain("&quot;wins&quot;");
    expect(xml).not.toContain('name="Q3 "');
  });

  it("refuses an empty deck rather than writing a presentation with no slides", () => {
    expect(() => exportFramesToPptx({ slides: [], now: NOW })).toThrow(/at least one slide/);
  });
});

/** Collapses `a/b/../c` so relationship targets can be compared against real part paths. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") out.pop();
    else if (segment !== "." && segment !== "") out.push(segment);
  }
  return out.join("/");
}
