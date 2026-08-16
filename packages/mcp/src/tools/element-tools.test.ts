import { getLabel } from "@deviva-draw/engine";
import type { ArrowElement, TextElement } from "@deviva-draw/engine";
import { describe, expect, it } from "vitest";
import { SceneSession } from "../scene-session";
import { createElementsTool, deleteElementsTool, listElementsTool, updateElementsTool } from "./element-tools";
import { ToolError } from "./tool-types";
import type { ElementSummary, McpToolDef } from "./tool-types";

/** Parses through the tool's own schema first — the same order every transport uses. */
async function run(tool: McpToolDef, session: SceneSession, input: unknown): Promise<unknown> {
  const result = await tool.handler(session, tool.schema.parse(input) as never);
  return result.data;
}

describe("create_elements", () => {
  it("creates a batch and returns summaries with generated ids", async () => {
    const session = new SceneSession();
    const data = (await run(createElementsTool, session, {
      elements: [
        { type: "rectangle", x: 0, y: 0, width: 120, height: 60 },
        { type: "ellipse", x: 200, y: 0 },
        { type: "text", x: 0, y: 100, text: "hello" },
      ],
    })) as { created: ElementSummary[] };
    expect(data.created).toHaveLength(3);
    expect(data.created[0]).toMatchObject({ type: "rectangle", x: 0, y: 0, width: 120, height: 60 });
    expect(data.created[1]?.width).toBeGreaterThan(0);
    expect(data.created[2]?.label).toBe("hello");
    for (const summary of data.created) expect(session.scene.getElement(summary.id)).toBeDefined();
  });

  it("binds a label inside a shape via the engine bound-text flow", async () => {
    const session = new SceneSession();
    const data = (await run(createElementsTool, session, {
      elements: [{ type: "rectangle", x: 0, y: 0, label: "Login service" }],
    })) as { created: ElementSummary[] };
    const container = session.scene.getElement(data.created[0]!.id);
    expect(container).toBeDefined();
    expect(getLabel(container!, session.scene)).toBe("Login service");
    // The label is a real bound text element, exactly like a double-click-typed one.
    const texts = session.scene.getElements().filter((element) => element.type === "text") as TextElement[];
    expect(texts).toHaveLength(1);
    expect(texts[0]?.containerId).toBe(container!.id);
  });

  it("normalizes negative-relative points into a consistent origin and box", async () => {
    const session = new SceneSession();
    const data = (await run(createElementsTool, session, {
      elements: [{ type: "arrow", x: 100, y: 100, points: [{ x: -50, y: 0 }, { x: 50, y: 20 }] }],
    })) as { created: ElementSummary[] };
    const arrow = session.scene.getElement(data.created[0]!.id) as ArrowElement;
    expect(arrow.x).toBe(50);
    expect(arrow.y).toBe(100);
    expect(arrow.width).toBe(100);
    expect(arrow.height).toBe(20);
    expect(arrow.points[0]).toEqual({ x: 0, y: 0 });
  });

  it("rejects an unknown element type with a schema error", () => {
    const session = new SceneSession();
    expect(() => createElementsTool.schema.parse({ elements: [{ type: "hexagon-wat", x: 0, y: 0 }] })).toThrow();
    expect(session.scene.getElements()).toHaveLength(0);
  });

  it("rejects an oversized batch (101 elements)", () => {
    const elements = Array.from({ length: 101 }, (_, index) => ({ type: "rectangle", x: index, y: 0 }));
    expect(() => createElementsTool.schema.parse({ elements })).toThrow();
  });

  it("assigns version 1 and a fractional index on insert (store invariants hold)", async () => {
    const session = new SceneSession();
    const data = (await run(createElementsTool, session, { elements: [{ type: "rectangle", x: 0, y: 0 }] })) as { created: ElementSummary[] };
    const stored = session.scene.getElement(data.created[0]!.id);
    expect(stored?.version).toBe(1);
    expect(stored?.index).not.toBe("");
  });
});

describe("update_elements", () => {
  async function seedRect(session: SceneSession): Promise<string> {
    const data = (await run(createElementsTool, session, { elements: [{ type: "rectangle", x: 0, y: 0 }] })) as { created: ElementSummary[] };
    return data.created[0]!.id;
  }

  it("applies whitelisted geometry/style changes and bumps the version", async () => {
    const session = new SceneSession();
    const id = await seedRect(session);
    const before = session.scene.getElement(id)!.version;
    await run(updateElementsTool, session, { updates: [{ id, x: 42, strokeColor: "#ff0000", opacity: 50 }] });
    const element = session.scene.getElement(id)!;
    expect(element.x).toBe(42);
    expect(element.strokeColor).toBe("#ff0000");
    expect(element.opacity).toBe(50);
    expect(element.version).toBeGreaterThan(before);
  });

  it("rejects the whole batch when any id is unknown (no partial application)", async () => {
    const session = new SceneSession();
    const id = await seedRect(session);
    await expect(run(updateElementsTool, session, { updates: [{ id, x: 7 }, { id: "ghost", x: 1 }] })).rejects.toThrow(ToolError);
    expect(session.scene.getElement(id)!.x).toBe(0);
  });

  it("rejects cross-type property misuse with targeted messages", async () => {
    const session = new SceneSession();
    const id = await seedRect(session);
    await expect(run(updateElementsTool, session, { updates: [{ id, text: "nope" }] })).rejects.toThrow(/not text/);
    await expect(run(updateElementsTool, session, { updates: [{ id, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] })).rejects.toThrow(/line\/arrow\/freedraw/);

    const arrowData = (await run(createElementsTool, session, {
      elements: [{ type: "arrow", x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
    })) as { created: ElementSummary[] };
    await expect(run(updateElementsTool, session, { updates: [{ id: arrowData.created[0]!.id, label: "no" }] })).rejects.toThrow(/cannot carry a label/);
  });

  it("sets a label on a container that had none, and replaces an existing one", async () => {
    const session = new SceneSession();
    const id = await seedRect(session);
    await run(updateElementsTool, session, { updates: [{ id, label: "first" }] });
    expect(getLabel(session.scene.getElement(id)!, session.scene)).toBe("first");
    await run(updateElementsTool, session, { updates: [{ id, label: "second" }] });
    expect(getLabel(session.scene.getElement(id)!, session.scene)).toBe("second");
    // Still exactly one bound text element.
    expect(session.scene.getElements().filter((element) => element.type === "text" && !element.isDeleted)).toHaveLength(1);
  });

  it("updates standalone text and re-derives its block size", async () => {
    const session = new SceneSession();
    const data = (await run(createElementsTool, session, { elements: [{ type: "text", x: 0, y: 0, text: "hi" }] })) as { created: ElementSummary[] };
    const id = data.created[0]!.id;
    const smallWidth = session.scene.getElement(id)!.width;
    await run(updateElementsTool, session, { updates: [{ id, text: "a considerably longer line of text" }] });
    const element = session.scene.getElement(id) as TextElement;
    expect(element.text).toBe("a considerably longer line of text");
    expect(element.width).toBeGreaterThan(smallWidth);
  });

  it("applies duplicate-id entries in one batch cumulatively (later entries see earlier changes)", async () => {
    const session = new SceneSession();
    const data = (await run(createElementsTool, session, {
      elements: [{ type: "arrow", x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
    })) as { created: ElementSummary[] };
    const id = data.created[0]!.id;
    // Entry 1 moves the arrow; entry 2 replaces points WITHOUT x — it must offset from the moved
    // x (100), not the stale pre-batch x (0).
    await run(updateElementsTool, session, {
      updates: [
        { id, x: 100 },
        { id, points: [{ x: 0, y: 0 }, { x: 20, y: 5 }] },
      ],
    });
    const arrow = session.scene.getElement(id) as ArrowElement;
    expect(arrow.x).toBe(100);
    expect(arrow.width).toBe(20);
  });

  it("replaces an arrow's points and re-derives its box", async () => {
    const session = new SceneSession();
    const data = (await run(createElementsTool, session, {
      elements: [{ type: "arrow", x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
    })) as { created: ElementSummary[] };
    const id = data.created[0]!.id;
    await run(updateElementsTool, session, { updates: [{ id, points: [{ x: 0, y: 0 }, { x: 30, y: 40 }] }] });
    const arrow = session.scene.getElement(id) as ArrowElement;
    expect(arrow.width).toBe(30);
    expect(arrow.height).toBe(40);
    expect(arrow.points).toHaveLength(2);
  });
});

describe("delete_elements", () => {
  it("deletes elements and cascades a container's bound label", async () => {
    const session = new SceneSession();
    const data = (await run(createElementsTool, session, { elements: [{ type: "rectangle", x: 0, y: 0, label: "bye" }] })) as { created: ElementSummary[] };
    const id = data.created[0]!.id;
    await run(deleteElementsTool, session, { ids: [id] });
    expect(session.scene.getElement(id)?.isDeleted).toBe(true);
    for (const element of session.scene.getElements()) expect(element.isDeleted).toBe(true);
  });

  it("rejects unknown ids without deleting anything", async () => {
    const session = new SceneSession();
    const data = (await run(createElementsTool, session, { elements: [{ type: "rectangle", x: 0, y: 0 }] })) as { created: ElementSummary[] };
    await expect(run(deleteElementsTool, session, { ids: [data.created[0]!.id, "ghost"] })).rejects.toThrow(/"ghost"/);
    expect(session.scene.getElement(data.created[0]!.id)?.isDeleted).toBe(false);
  });
});

describe("list_elements", () => {
  it("filters by type and paginates", async () => {
    const session = new SceneSession();
    await run(createElementsTool, session, {
      elements: [
        { type: "rectangle", x: 0, y: 0 },
        { type: "rectangle", x: 10, y: 0 },
        { type: "ellipse", x: 20, y: 0 },
      ],
    });
    const rects = (await run(listElementsTool, session, { type: "rectangle" })) as { total: number; elements: ElementSummary[] };
    expect(rects.total).toBe(2);
    const page = (await run(listElementsTool, session, { limit: 1, offset: 1 })) as { total: number; elements: ElementSummary[] };
    expect(page.total).toBe(3);
    expect(page.elements).toHaveLength(1);
  });
});
