import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deserializeScene, readEmbeddedSceneDataFromSvg } from "@deviva-draw/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SceneSession } from "../scene-session";
import { createElementsTool } from "./element-tools";
import { exportSvgTool } from "./export-tools";
import { ToolError } from "./tool-types";
import type { ElementSummary, McpToolDef } from "./tool-types";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deviva-mcp-export-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(tool: McpToolDef, session: SceneSession, input: unknown): Promise<unknown> {
  const result = await tool.handler(session, tool.schema.parse(input) as never);
  return result.data;
}

async function seededSession(): Promise<{ session: SceneSession; ids: string[] }> {
  const session = new SceneSession();
  const data = (await run(createElementsTool, session, {
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 100, height: 60, label: "Box" },
      { type: "ellipse", x: 200, y: 0, width: 80, height: 80 },
    ],
  })) as { created: ElementSummary[] };
  return { session, ids: data.created.map((summary) => summary.id) };
}

describe("export_svg", () => {
  it("returns inline SVG whose embedded scene data re-opens as an editable scene", async () => {
    const { session } = await seededSession();
    const data = (await run(exportSvgTool, session, {})) as { svg: string; bytes: number };
    expect(data.svg).toContain("<svg");
    expect(data.svg).toContain("Box");
    expect(data.bytes).toBeGreaterThan(0);

    const embedded = readEmbeddedSceneDataFromSvg(data.svg);
    expect(embedded).not.toBeNull();
    const reopened = deserializeScene(JSON.parse(embedded!));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      expect(reopened.scene.getElements().filter((element) => !element.isDeleted)).toHaveLength(3); // 2 shapes + bound label
    }
  });

  it("writes to a file when given a path", async () => {
    const { session } = await seededSession();
    const path = join(dir, "out.svg");
    const data = (await run(exportSvgTool, session, { path })) as { path: string; svg?: string };
    expect(data.path).toBe(path);
    expect(data.svg).toBeUndefined();
    expect(readFileSync(path, "utf8")).toContain("<svg");
  });

  it("exports a selection and automatically includes selected shapes' labels", async () => {
    const { session, ids } = await seededSession();
    const data = (await run(exportSvgTool, session, { selectionIds: [ids[0]] })) as { svg: string };
    expect(data.svg).toContain("Box");
    // The unselected ellipse still influences nothing: export a tight frame around the rect+label.
    const full = (await run(exportSvgTool, session, {})) as { svg: string };
    expect(data.svg.length).toBeLessThan(full.svg.length);
  });

  it("rejects unknown selection ids and empty scenes with ToolError", async () => {
    const { session } = await seededSession();
    await expect(run(exportSvgTool, session, { selectionIds: ["ghost"] })).rejects.toThrow(ToolError);

    const empty = new SceneSession();
    await expect(run(exportSvgTool, empty, {})).rejects.toThrow(/nothing to export/);
  });

  it("omits scene metadata when embedSceneData is false", async () => {
    const { session } = await seededSession();
    const data = (await run(exportSvgTool, session, { embedSceneData: false })) as { svg: string };
    expect(readEmbeddedSceneDataFromSvg(data.svg)).toBeNull();
  });

  it("respects the session root for export paths", async () => {
    const session = new SceneSession({ rootDir: dir });
    await run(createElementsTool, session, { elements: [{ type: "rectangle", x: 0, y: 0 }] });
    const outside = join(tmpdir(), "deviva-escape.svg");
    await expect(run(exportSvgTool, session, { path: outside })).rejects.toThrow(/outside the allowed root/);
    expect(existsSync(outside)).toBe(false);
  });
});
