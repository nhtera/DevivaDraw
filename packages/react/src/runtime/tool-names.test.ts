import { describe, expect, it } from "vitest";
import { DRAW_CAPABLE_TOOL_NAMES, ERASER_TOOL_NAME, FREEDRAW_TOOL_NAME, PAN_TOOL_NAME, resolveTouchDrawPolicy, SELECT_TOOL_NAME } from "./tool-names";

describe("resolveTouchDrawPolicy", () => {
  it("pans only when the preference is on AND the active tool creates content", () => {
    expect(resolveTouchDrawPolicy(true, FREEDRAW_TOOL_NAME)).toBe("pan");
    expect(resolveTouchDrawPolicy(false, FREEDRAW_TOOL_NAME)).toBe("draw");
  });

  it("keeps native touch behavior for tap/selection-oriented tools even with the preference on", () => {
    for (const tool of [SELECT_TOOL_NAME, PAN_TOOL_NAME, ERASER_TOOL_NAME, "lasso", "bucket-fill", "laser"]) {
      expect(resolveTouchDrawPolicy(true, tool)).toBe("draw");
      expect(DRAW_CAPABLE_TOOL_NAMES.has(tool)).toBe(false);
    }
  });
});
