import { describe, expect, it } from "vitest";
import { SceneSession } from "../scene-session";
import { createElementsTool } from "./element-tools";
import { searchSceneContentTool } from "./search-tools";
import type { ElementSummary, McpToolDef } from "./tool-types";

async function run(tool: McpToolDef, session: SceneSession, input: unknown): Promise<unknown> {
  const result = await tool.handler(session, tool.schema.parse(input) as never);
  return result.data;
}

describe("search_scene_content", () => {
  async function seeded(): Promise<SceneSession> {
    const session = new SceneSession();
    await run(createElementsTool, session, {
      elements: [
        { type: "rectangle", x: 0, y: 0, label: "Login service" },
        { type: "note", x: 300, y: 0, label: "TODO: rotate credentials" },
        { type: "text", x: 0, y: 200, text: "standalone login note" },
        { type: "ellipse", x: 600, y: 0 },
      ],
    });
    return session;
  }

  it("finds label matches and reports the CONTAINER, not the hidden text element", async () => {
    const session = await seeded();
    const data = (await run(searchSceneContentTool, session, { query: "login" })) as { total: number; matches: ElementSummary[] };
    expect(data.total).toBe(2);
    const types = data.matches.map((match) => match.type).sort();
    expect(types).toEqual(["rectangle", "text"]);
  });

  it("is case-insensitive and filters by resolved type", async () => {
    const session = await seeded();
    const data = (await run(searchSceneContentTool, session, { query: "LOGIN", type: "rectangle" })) as { total: number; matches: ElementSummary[] };
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0]?.label).toBe("Login service");
  });

  it("returns an empty result for a no-hit query", async () => {
    const session = await seeded();
    const data = (await run(searchSceneContentTool, session, { query: "zzz-nothing" })) as { total: number; matches: ElementSummary[] };
    expect(data).toMatchObject({ total: 0, matches: [] });
  });
});
