import { describe, expect, it } from "vitest";
import { orderFramesAsSlides, parseSlideNumber } from "./frame-slide-order";

const frame = (id: string, name: string) => ({ id, name });
const idsOf = (frames: { id: string; name: string }[]) => orderFramesAsSlides(frames).map((slide) => slide.id);

describe("parseSlideNumber", () => {
  it.each([
    ["1. Intro", 1],
    ["2) Results", 2],
    ["3 - Summary", 3],
    ["10: Appendix", 10],
    ["4 Overview", 4],
    ["  5. Padded", 5],
    ["7", 7],
  ])("reads the leading number from %j", (name, expected) => {
    expect(parseSlideNumber(name)).toBe(expected);
  });

  it.each([["Intro"], ["Frame 1"], ["Q3 Plan"], [""], ["- 2 Dashed"]])("returns null for %j, which carries no leading number", (name) => {
    expect(parseSlideNumber(name)).toBeNull();
  });

  it("reads a leading year as a slide number — the accepted cost of allowing a space separator", () => {
    // Pinned rather than fixed: supporting `"1 Intro"` means a space separates, which means a name
    // opening with a year parses as that number. It sorts last among numbered frames and still
    // presents fine. See the regex doc for why this beats requiring punctuation.
    expect(parseSlideNumber("2026 Roadmap")).toBe(2026);
    // Digits fused to letters are genuinely not a slide number.
    expect(parseSlideNumber("2026Roadmap")).toBeNull();
  });
});

describe("orderFramesAsSlides", () => {
  it("keeps scene order when no frame is numbered", () => {
    expect(idsOf([frame("a", "Intro"), frame("b", "Body"), frame("c", "End")])).toEqual(["a", "b", "c"]);
  });

  it("orders by the numeric prefix, overriding scene order", () => {
    expect(idsOf([frame("a", "3. Last"), frame("b", "1. First"), frame("c", "2. Middle")])).toEqual(["b", "c", "a"]);
  });

  it("sorts numerically, not lexically (10 comes after 9)", () => {
    expect(idsOf([frame("a", "10. Ten"), frame("b", "9. Nine")])).toEqual(["b", "a"]);
  });

  it("puts numbered frames ahead of unnumbered ones — a half-numbered deck is mid-ordering", () => {
    expect(idsOf([frame("a", "Loose"), frame("b", "2. Second"), frame("c", "Another"), frame("d", "1. First")])).toEqual(["d", "b", "a", "c"]);
  });

  it("breaks ties by incoming order, so duplicates never reshuffle", () => {
    expect(idsOf([frame("a", "1. One"), frame("b", "1. Also one"), frame("c", "1. Third")])).toEqual(["a", "b", "c"]);
  });

  it("handles the empty deck and the single-frame deck", () => {
    expect(orderFramesAsSlides([])).toEqual([]);
    expect(idsOf([frame("only", "Solo")])).toEqual(["only"]);
  });

  it("carries the parsed order through for display", () => {
    const slides = orderFramesAsSlides([frame("a", "2. Second"), frame("b", "Unnumbered")]);
    expect(slides).toEqual([
      { id: "a", name: "2. Second", order: 2 },
      { id: "b", name: "Unnumbered", order: null },
    ]);
  });

  it("does not mutate its input", () => {
    const input = [frame("a", "3. C"), frame("b", "1. A")];
    const snapshot = [...input];
    orderFramesAsSlides(input);
    expect(input).toEqual(snapshot);
  });
});
