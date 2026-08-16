import { describe, expect, it } from "vitest";
import { SceneSession } from "../scene-session";
import { formatGuideTools, readSceneFormatTool } from "./format-guide";
import { allTools } from "./index";

describe("read_scene_format", () => {
  it("returns the guide, and every tool name the guide mentions actually exists", async () => {
    const result = await readSceneFormatTool.handler(new SceneSession(), {} as never);
    const guide = (result.data as { guide: string }).guide;
    expect(guide).toContain("Coordinate system");

    const registered = new Set(allTools.map((tool) => tool.name));
    // Any snake_case word in the guide that looks like a tool reference must be a registered tool —
    // the cheap docs-vs-registry drift check the plan calls for.
    const mentioned = [...new Set(guide.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];
    expect(mentioned.length).toBeGreaterThan(4);
    for (const name of mentioned) expect(registered, `guide mentions unknown tool "${name}"`).toContain(name);
  });

  it("is registered in the tool core", () => {
    expect(allTools.some((tool) => tool.name === "read_scene_format")).toBe(true);
    expect(formatGuideTools).toHaveLength(1);
  });
});
