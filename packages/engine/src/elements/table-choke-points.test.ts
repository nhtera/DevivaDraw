/**
 * Cross-cutting proof that the table element is wired through every runtime dispatcher the
 * "add a new element type" checklist enumerates — none are compiler-enforced, and the historical
 * failure mode is a silently-missing case (resize) or a hard throw (render). One file so the whole
 * checklist is auditable in one place.
 */
import { describe, expect, it, vi } from "vitest";
import { isBindableTarget, outlineKindOf } from "../bindings/shape-outline-geometry";
import { buildElementDrawable } from "../render/rough-renderer";
import type { Camera } from "../render/camera";
import { deserializeScene, deserializeSceneLenient, serializeScene } from "../persistence/serialize-scene";
import { findTextMatches } from "../scene/find-text-matches";
import { Scene } from "../scene/scene";
import { duplicateElements } from "../selection/clipboard";
import { hitTestElement } from "../selection/hit-test";
import { dispatchResize } from "../selection/resize-dispatch";
import { createTableElement } from "./table-element";
import type { TableElement } from "./table-element";
import { MIN_COLUMN_WIDTH } from "./table-layout";

const CAMERA: Camera = { scrollX: 0, scrollY: 0, zoom: 1 };

function seededTable(): TableElement {
  return createTableElement({ x: 0, y: 0, columnWidths: [100, 100], rowHeights: [40, 40], cells: [["alpha", "beta"], ["gamma", "delta"]] });
}

describe("table — persistence round trip", () => {
  it("survives serialize→deserialize bit-identically on strict and lenient paths", () => {
    const scene = new Scene();
    const stored = scene.addElement(seededTable());
    const payload = serializeScene(scene);

    const strict = deserializeScene(payload);
    expect(strict.ok).toBe(true);
    if (strict.ok) expect(strict.scene.getElement(stored.id)).toEqual(stored);

    const lenient = deserializeSceneLenient(payload);
    expect(lenient.ok).toBe(true);
    if (lenient.ok) expect(lenient.scene.getElement(stored.id)).toEqual(stored);
  });

  it("lenient path drops a malformed table (jagged cells) but keeps its siblings", () => {
    const scene = new Scene();
    const good = scene.addElement(seededTable());
    const bad = scene.addElement(seededTable());
    const payload = structuredClone(serializeScene(scene)) as unknown as { elements: Record<string, unknown>[] };
    const badRaw = payload.elements.find((element) => element.id === bad.id)!;
    badRaw.cells = [["only-one-cell"]]; // row count no longer matches rowHeights

    const strict = deserializeScene(payload as never);
    expect(strict.ok).toBe(false);

    const lenient = deserializeSceneLenient(payload as never);
    expect(lenient.ok).toBe(true);
    if (lenient.ok) {
      expect(lenient.scene.getElement(good.id)).toBeTruthy();
      expect(lenient.scene.getElement(bad.id)).toBeFalsy();
    }
  });

  it("rejects the hostile-input battery with a reason each", () => {
    const vectors: [string, (raw: Record<string, unknown>) => void][] = [
      ["jagged row", (raw) => (raw.cells = [["a"], ["b", "c"]])],
      ["non-string cell", (raw) => (raw.cells = [[1, "b"], ["c", "d"]])],
      ["NaN column", (raw) => (raw.columnWidths = [Number.NaN, 100])],
      ["negative row height", (raw) => (raw.rowHeights = [-5, 40])],
      ["over-cap columns", (raw) => { raw.columnWidths = Array.from({ length: 17 }, () => 50); raw.cells = [Array.from({ length: 17 }, () => "")]; raw.rowHeights = [40]; }],
      ["oversized cell text", (raw) => (raw.cells = [["x".repeat(4001), "b"], ["c", "d"]])],
      ["bad fontSize", (raw) => (raw.fontSize = 0)],
      ["width desynced from column sum", (raw) => (raw.width = 99999)],
    ];
    for (const [name, corrupt] of vectors) {
      const scene = new Scene();
      scene.addElement(seededTable());
      const payload = structuredClone(serializeScene(scene)) as unknown as { elements: Record<string, unknown>[] };
      corrupt(payload.elements[0]!);
      const result = deserializeScene(payload as never);
      expect(result.ok, `vector "${name}" must be rejected`).toBe(false);
    }
  });
});

describe("table — resize dispatch (the silent-no-op bug class)", () => {
  it("has a case: scales the grid instead of returning null", () => {
    const el = seededTable(); // 200x80
    const update = dispatchResize(el, { x: 0, y: 0, width: 200, height: 80 }, { x: 0, y: 0, width: 400, height: 160 });
    expect(update).not.toBeNull();
    const table = update as Partial<TableElement>;
    expect(table.columnWidths).toEqual([200, 200]);
    expect(table.rowHeights).toEqual([80, 80]);
    expect(table.width).toBe(400);
  });

  it("keeps width equal to the clamped column sum when dragged below minimum", () => {
    const el = seededTable();
    const update = dispatchResize(el, { x: 0, y: 0, width: 200, height: 80 }, { x: 0, y: 0, width: 8, height: 8 }) as Partial<TableElement>;
    expect(update.width).toBe(MIN_COLUMN_WIDTH * 2);
    expect(update.columnWidths!.reduce((a, b) => a + b, 0)).toBe(update.width);
  });
});

describe("table — hit test and binding", () => {
  it("whole interior is a hit target (the note pattern)", () => {
    const el = seededTable();
    expect(hitTestElement(el, { x: 100, y: 40 }, 4)).toBe(true); // dead center
    expect(hitTestElement(el, { x: 300, y: 40 }, 4)).toBe(false); // outside
  });

  it("is arrow-bindable via the rect outline family", () => {
    const el = seededTable();
    expect(outlineKindOf(el)).toBe("rect");
    expect(isBindableTarget(el)).toBe(true);
  });
});

describe("table — find on canvas", () => {
  it("matches cell text (case-insensitive) and respects hidden layers", () => {
    const scene = new Scene();
    const el = scene.addElement(seededTable());
    expect(findTextMatches(scene, "GAMMA")).toEqual([el.id]);
    expect(findTextMatches(scene, "missing")).toEqual([]);
    const layer = scene.addLayer("hide-me");
    scene.updateElement(el.id, { layerId: layer.id });
    scene.setLayerVisible(layer.id, false);
    expect(findTextMatches(scene, "gamma")).toEqual([]);
  });

  it("never throws on a malformed collab-ingested grid", () => {
    const scene = new Scene();
    const el = scene.addElement(seededTable());
    scene.applyRemoteElement({ ...el, version: el.version + 1, versionNonce: 1, cells: "hostile" } as unknown as TableElement);
    expect(() => findTextMatches(scene, "alpha")).not.toThrow();
  });
});

describe("table — duplicate independence (the aliasing pin)", () => {
  it("deep-clones the grid so editing a copy never touches the original", () => {
    const scene = new Scene();
    const original = scene.addElement(seededTable()) as TableElement;
    const copyIds = duplicateElements(scene, [original.id]);
    expect(copyIds).toHaveLength(1);
    const copy = scene.getElement(copyIds[0]!) as TableElement;
    expect(copy.cells).toEqual(original.cells);
    expect(copy.cells).not.toBe(original.cells);
    expect(copy.cells[0]).not.toBe(original.cells[0]);
    expect(copy.columnWidths).not.toBe(original.columnWidths);
    expect(copy.rowHeights).not.toBe(original.rowHeights);
  });

  it("duplicating a collab-ingested MALFORMED table degrades instead of crashing (reads go through table-layout)", () => {
    const scene = new Scene();
    const seeded = scene.addElement(seededTable());
    scene.applyRemoteElement({ ...seeded, version: seeded.version + 1, versionNonce: 1, cells: "hostile", rowHeights: [null, 40] } as unknown as TableElement);
    const copyIds = duplicateElements(scene, [seeded.id]);
    expect(copyIds).toHaveLength(1);
    const copy = scene.getElement(copyIds[0]!) as TableElement;
    // Sanitized shape: the one readable row height survives, cells rebuilt to match, all strings.
    expect(copy.rowHeights).toEqual([40]);
    expect(copy.cells).toHaveLength(1);
    for (const cell of copy.cells[0]!) expect(typeof cell).toBe("string");
  });
});

describe("unknown element types — render hardening", () => {
  it("buildElementDrawable skips (returns null) and warns once instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fake = { ...createTableElement({ x: 0, y: 0 }), type: "future-thing" } as never;
      const drawer = { rectangle: vi.fn(), ellipse: vi.fn(), polygon: vi.fn(), path: vi.fn(), linearPath: vi.fn() };
      expect(buildElementDrawable(drawer as never, fake, CAMERA)).toBeNull();
      expect(buildElementDrawable(drawer as never, fake, CAMERA)).toBeNull();
      expect(warn.mock.calls.filter(([message]) => String(message).includes("future-thing"))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
