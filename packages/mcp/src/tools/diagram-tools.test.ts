import { describe, expect, it } from "vitest";
import { SceneSession } from "../scene-session";
import { createDiagramFromMermaidTool, createDiagramTool } from "./diagram-tools";
import { ToolError } from "./tool-types";
import type { ElementSummary, McpToolDef } from "./tool-types";

async function run(tool: McpToolDef, session: SceneSession, input: unknown): Promise<unknown> {
  const result = await tool.handler(session, tool.schema.parse(input) as never);
  return result.data;
}

const FLOWCHART = "flowchart TD\n  a[Start] --> b{Decide}\n  b -->|yes| c[Ship]\n  b -->|no| d[Fix]\n";

describe("create_diagram_from_mermaid", () => {
  it("converts a flowchart into laid-out scene elements", async () => {
    const session = new SceneSession();
    const data = (await run(createDiagramFromMermaidTool, session, { mermaid: FLOWCHART })) as { diagramType: string; created: number; elements: ElementSummary[] };
    expect(data.diagramType).toBe("flowchart");
    expect(data.created).toBeGreaterThanOrEqual(7); // 4 nodes + labels + 3 edges
    expect(session.scene.getElements().filter((element) => !element.isDeleted)).toHaveLength(data.created);
  });

  it("applies the (x, y) offset to every inserted element", async () => {
    const plain = new SceneSession();
    const offset = new SceneSession();
    const plainData = (await run(createDiagramFromMermaidTool, plain, { mermaid: FLOWCHART })) as { elements: ElementSummary[] };
    const offsetData = (await run(createDiagramFromMermaidTool, offset, { mermaid: FLOWCHART, x: 500, y: 300 })) as { elements: ElementSummary[] };
    expect(offsetData.elements[0]!.x - plainData.elements[0]!.x).toBe(500);
    expect(offsetData.elements[0]!.y - plainData.elements[0]!.y).toBe(300);
  });

  it("rejects malformed and unsupported sources with actionable errors", async () => {
    const session = new SceneSession();
    await expect(run(createDiagramFromMermaidTool, session, { mermaid: "   " })).rejects.toThrow();
    await expect(run(createDiagramFromMermaidTool, session, { mermaid: "pie title Nope\n  \"a\": 1" })).rejects.toThrow(ToolError);
    expect(session.scene.getElements()).toHaveLength(0);
  });
});

describe("create_diagram (semantic nodes + edges)", () => {
  it("lays out a 10-node graph with no overlapping node bounds", async () => {
    const session = new SceneSession();
    const nodes = Array.from({ length: 10 }, (_, index) => ({ id: `n${index}`, label: `Step ${index}` }));
    const edges = Array.from({ length: 9 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}` }));
    const data = (await run(createDiagramTool, session, { nodes, edges })) as { created: number };
    expect(data.created).toBeGreaterThanOrEqual(19); // 10 shapes + 10 labels + 9 arrows minus dedupe variance

    const shapes = session.scene.getElements().filter((element) => !element.isDeleted && element.type !== "arrow" && element.type !== "text");
    expect(shapes).toHaveLength(10);
    for (const a of shapes) {
      for (const b of shapes) {
        if (a.id === b.id) continue;
        const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlaps, `nodes ${a.id} and ${b.id} overlap`).toBe(false);
      }
    }
  });

  it("honors direction RIGHT (layout extends horizontally, not vertically)", async () => {
    const session = new SceneSession();
    const input = {
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    };
    const down = new SceneSession();
    await run(createDiagramTool, down, input);
    await run(createDiagramTool, session, { ...input, direction: "RIGHT" });
    const spanOf = (s: SceneSession, axis: "x" | "y") => {
      const shapes = s.scene.getElements().filter((element) => element.type === "rectangle");
      const positions = shapes.map((element) => element[axis]);
      return Math.max(...positions) - Math.min(...positions);
    };
    expect(spanOf(session, "x")).toBeGreaterThan(spanOf(session, "y"));
    expect(spanOf(down, "y")).toBeGreaterThan(spanOf(down, "x"));
  });

  it("rejects duplicate node ids and unknown edge references", async () => {
    const session = new SceneSession();
    await expect(
      run(createDiagramTool, session, { nodes: [{ id: "a", label: "A" }, { id: "a", label: "A2" }], edges: [] }),
    ).rejects.toThrow(/duplicate node id/);
    await expect(
      run(createDiagramTool, session, { nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "ghost" }] }),
    ).rejects.toThrow(/unknown node id/);
    expect(session.scene.getElements()).toHaveLength(0);
  });
});
