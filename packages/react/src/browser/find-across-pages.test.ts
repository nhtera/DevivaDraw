import { createFrameElement, createTextElement, Scene } from "@deviva-draw/engine";
import { describe, expect, it } from "vitest";
import { PageStore } from "../pages/page-store";
import { findMatchesAcrossPages } from "./find-across-pages";

function documentWithPages(...texts: string[][]): { store: PageStore; scenes: Scene[] } {
  const scenes = texts.map(() => new Scene());
  const store = new PageStore(
    scenes.map((scene, index) => ({ id: `page-${index + 1}`, name: `Page ${index + 1}`, scene })),
    null,
  );
  texts.forEach((pageTexts, index) => {
    pageTexts.forEach((text, row) => scenes[index]!.addElement(createTextElement({ x: 0, y: row * 40, text })));
  });
  return { store, scenes };
}

describe("findMatchesAcrossPages", () => {
  it("finds matches on every page, in page order then draw order", () => {
    const { store, scenes } = documentWithPages(["alpha one"], ["alpha two", "alpha three"]);
    const [firstPageMatch] = scenes[0]!.getElements();
    const [secondPageFirst, secondPageSecond] = scenes[1]!.getElements();

    expect(findMatchesAcrossPages(store, "alpha")).toEqual([
      { pageId: "page-1", pageName: "Page 1", elementId: firstPageMatch!.id },
      { pageId: "page-2", pageName: "Page 2", elementId: secondPageFirst!.id },
      { pageId: "page-2", pageName: "Page 2", elementId: secondPageSecond!.id },
    ]);
  });

  it("finds a match on an inactive page — the defect this exists to fix", () => {
    const { store, scenes } = documentWithPages(["nothing here"], ["the needle"]);
    expect(store.getActivePageId()).toBe("page-1");

    const matches = findMatchesAcrossPages(store, "needle");

    expect(matches).toHaveLength(1);
    expect(matches[0]!.pageId).toBe("page-2");
    expect(matches[0]!.elementId).toBe(scenes[1]!.getElements()[0]!.id);
  });

  it("carries the page's current name, so a rename shows up without a re-search path", () => {
    const { store } = documentWithPages(["nothing"], ["match me"]);
    store.renamePage("page-2", "Pricing");

    expect(findMatchesAcrossPages(store, "match")[0]!.pageName).toBe("Pricing");
  });

  it("matches frame names across pages", () => {
    const { store, scenes } = documentWithPages([], []);
    const frame = scenes[1]!.addElement(createFrameElement({ x: 0, y: 0, name: "Pricing slide" }));

    expect(findMatchesAcrossPages(store, "pricing")).toEqual([{ pageId: "page-2", pageName: "Page 2", elementId: frame.id }]);
  });

  it("an empty query matches nothing anywhere", () => {
    const { store } = documentWithPages(["alpha"], ["alpha"]);
    expect(findMatchesAcrossPages(store, "   ")).toEqual([]);
  });
});
