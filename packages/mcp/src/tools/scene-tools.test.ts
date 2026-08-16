import { SCENE_DOCUMENT_TYPE } from "@deviva-draw/engine";
import type { SceneDocumentV1 } from "@deviva-draw/engine";
import { describe, expect, it } from "vitest";
import { SceneSession } from "../scene-session";
import { createElementsTool } from "./element-tools";
import { describeSceneTool, getSceneContentTool, newSceneTool } from "./scene-tools";
import type { McpToolDef } from "./tool-types";

async function run(tool: McpToolDef, session: SceneSession, input: unknown): Promise<unknown> {
  const result = await tool.handler(session, tool.schema.parse(input) as never);
  return result.data;
}

describe("describe_scene", () => {
  it("reports counts, bounds, and page info without dumping elements", async () => {
    const session = new SceneSession();
    await run(createElementsTool, session, {
      elements: [
        { type: "rectangle", x: 0, y: 0, width: 100, height: 100 },
        { type: "ellipse", x: 200, y: 0, width: 50, height: 50 },
      ],
    });
    const data = (await run(describeSceneTool, session, {})) as {
      elementCount: number;
      countsByType: Record<string, number>;
      bounds: { x: number; width: number } | null;
      pageCount: number;
      filePath: string | null;
    };
    expect(data.elementCount).toBe(2);
    expect(data.countsByType).toEqual({ rectangle: 1, ellipse: 1 });
    expect(data.bounds).toMatchObject({ x: 0, width: 250 });
    expect(data.pageCount).toBe(1);
    expect(data.filePath).toBeNull();
    expect(JSON.stringify(data)).not.toContain("versionNonce");
  });

  it("reports null bounds for an empty scene", async () => {
    const session = new SceneSession();
    const data = (await run(describeSceneTool, session, {})) as { bounds: unknown; elementCount: number };
    expect(data.bounds).toBeNull();
    expect(data.elementCount).toBe(0);
  });
});

describe("get_scene_content", () => {
  it("returns the full versioned scene document — the one sanctioned full dump", async () => {
    const session = new SceneSession();
    await run(createElementsTool, session, { elements: [{ type: "rectangle", x: 5, y: 5 }] });
    const data = (await run(getSceneContentTool, session, {})) as SceneDocumentV1;
    expect(data.type).toBe(SCENE_DOCUMENT_TYPE);
    expect(data.elements).toHaveLength(1);
    expect(data.elements[0]).toMatchObject({ type: "rectangle", x: 5, y: 5 });
  });
});

describe("new_scene", () => {
  it("clears the scene and applies the requested background", async () => {
    const session = new SceneSession();
    await run(createElementsTool, session, { elements: [{ type: "rectangle", x: 0, y: 0 }] });
    const data = (await run(newSceneTool, session, { background: "#ffffff" })) as { ok: boolean; background: string | null };
    expect(data).toEqual({ ok: true, background: "#ffffff" });
    expect(session.scene.getElements()).toHaveLength(0);
    expect(session.scene.getBackground()).toBe("#ffffff");
  });
});
