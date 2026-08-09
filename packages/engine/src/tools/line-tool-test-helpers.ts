/**
 * Shared fakes/helpers for `line-tool.test.ts` and its sibling files (split across several files —
 * not itself a `*.test.ts` — purely to keep each under the house line-count limit while sharing one
 * set of fakes instead of duplicating them).
 */
import { vi } from "vitest";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import type { LineTool } from "./line-tool";

export const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

export function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

/** Simulates one full click: a gesture-start immediately followed by a gesture-end at the same point. */
export function click(tool: LineTool, point: { x: number; y: number }): void {
  tool.onGestureStart(point, NO_MODIFIERS);
  tool.onGestureEnd(point, NO_MODIFIERS);
}

/** Simulates a press-drag-release: down at `from`, a move to `to`, then release at `to`. */
export function drag(tool: LineTool, from: { x: number; y: number }, to: { x: number; y: number }): void {
  tool.onGestureStart(from, NO_MODIFIERS);
  tool.onGestureMove(to, NO_MODIFIERS);
  tool.onGestureEnd(to, NO_MODIFIERS);
}
