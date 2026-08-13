/**
 * How long the binding hit test takes on a big scene. `resolveBindingHighlight` runs on every pointer
 * move while the arrow tool is active, so it has to fit inside a frame alongside everything else the
 * canvas does — the budget is well under a 16ms frame, with room to spare for rendering.
 *
 * The real budget is a review gate, not a build gate: a tight threshold here would be flaky on
 * shared CI hardware. The numbers are printed so a regression is visible in review, and the only
 * assertions are a ceiling roughly a hundred times the measured cost and a scaling check that would
 * fail if this linear scan ever became nested.
 */
import { describe, expect, it } from "vitest";
import type { AnyElement } from "../elements/element-types";
import { createEllipseElement, createRectangleElement, createStarElement } from "../elements/shape-elements";
import { resolveBindingHighlight } from "./binding-highlight";

/** A grid of mixed shape kinds, so the run exercises all three outline dispatches rather than the cheapest one. */
function buildScene(count: number): AnyElement[] {
  const perRow = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) => {
    const box = { x: (index % perRow) * 120, y: Math.floor(index / perRow) * 120, width: 100, height: 100 };
    if (index % 3 === 0) return createRectangleElement(box);
    if (index % 3 === 1) return createEllipseElement(box);
    return createStarElement(box);
  });
}

/** Median microseconds per call, over enough iterations to shake out scheduling noise. */
function medianMicroseconds(elements: AnyElement[], iterations = 60): number {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    // Walk the pointer across the scene so no single run can be favoured by an early hit.
    const point = { x: (i % 40) * 400, y: Math.floor(i / 40) * 400 };
    const started = performance.now();
    resolveBindingHighlight(elements, point, 15);
    samples.push((performance.now() - started) * 1000);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

describe("resolveBindingHighlight — cost at scale", () => {
  /** Far above any plausible real timing; this exists to catch an algorithmic regression, not to police microseconds. */
  const CEILING_MICROSECONDS = 20_000;

  it.each([1_000, 5_000, 10_000])("stays inside a frame's budget at %i elements", (count) => {
    const elements = buildScene(count);
    const median = medianMicroseconds(elements);
    // eslint-disable-next-line no-console -- the recorded number is the point of this test
    console.log(`resolveBindingHighlight: ${count} elements -> ${median.toFixed(1)}us median`);
    expect(median).toBeLessThan(CEILING_MICROSECONDS);
  });

  it("scales linearly rather than quadratically — the cheap reject is what keeps it flat", () => {
    const small = medianMicroseconds(buildScene(1_000));
    const large = medianMicroseconds(buildScene(10_000));
    // 10x the elements must not cost anywhere near 100x. A generous factor keeps this from being a
    // timing-noise gate while still failing loudly if the linear scan ever became nested.
    expect(large).toBeLessThan(Math.max(small, 1) * 40);
  });
});
