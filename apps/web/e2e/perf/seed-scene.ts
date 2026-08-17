/**
 * Deterministic scene generators for the scale benchmark, plus the localStorage seeding helper.
 *
 * Built as plain serialized JSON rather than by driving the UI: 10 000 elements cannot be drawn by
 * synthetic pointer gestures in any sensible time, and the autosave document is a stable, validated
 * contract (`packages/engine/src/persistence/scene-validation.ts`) that the app restores on load.
 *
 * "Deterministic" is load-bearing — every run of a given scale must produce byte-identical scenes,
 * or a before/after comparison measures the scene difference as much as the code change. Hence the
 * seeded PRNG below and the complete absence of `Math.random`/`Date.now` in the generated content.
 *
 * The element mix is deliberately heterogeneous (shapes, bound arrows, text, freehand): a scene of
 * 10 000 rectangles would exercise one drawable cache and one render dispatch, and would flatter
 * any measurement taken from it.
 */

/** The autosave slot the app restores from on load — see `packages/engine/src/persistence/local-storage-autosave.ts`. */
export const AUTOSAVE_STORAGE_KEY = "devivadraw:autosave:v1";

export type SceneScale = 1_000 | 5_000 | 10_000;

/**
 * Mulberry32 — a tiny seeded PRNG. Any deterministic generator would do; this one is four lines and
 * has no dependencies, which matters for a file that has to run inside `page.evaluate`.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BaseOverrides {
  [key: string]: unknown;
}

/** Every `BaseElement` field the validator requires, with the element-factory defaults. */
function base(id: string, index: number, x: number, y: number, width: number, height: number, overrides: BaseOverrides = {}): Record<string, unknown> {
  return {
    id,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    // Fixed, not random: rough.js derives its hand-drawn jitter from this, so a varying seed would
    // change the drawn geometry (and therefore the cached drawable) between runs.
    seed: 1000 + index,
    groupIds: [],
    frameId: null,
    boundElements: null,
    link: null,
    locked: false,
    // Fractional-index ordering: plain zero-padded keys sort correctly and are stable across runs.
    index: `a${String(index).padStart(6, "0")}`,
    version: 1,
    versionNonce: 1,
    updated: 1,
    isDeleted: false,
    ...overrides,
  };
}

/**
 * `count` elements laid out on a grid, cycling through four kinds in a fixed 10-element pattern:
 * 4 shapes, 2 of which carry a bound arrow between them, 2 text labels, and 2 freehand strokes.
 *
 * The grid is wider than any viewport on purpose, so a benchmark that pans is genuinely moving
 * through new content rather than re-drawing the same visible set.
 */
export function buildScaleScene(count: number): { elements: Record<string, unknown>[] } {
  const random = seededRandom(0x5eed);
  const elements: Record<string, unknown>[] = [];
  const perRow = Math.ceil(Math.sqrt(count));
  const CELL = 180;

  for (let i = 0; i < count && elements.length < count; i += 1) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = col * CELL;
    const y = row * CELL;
    const kind = i % 10;

    if (kind <= 3) {
      const shapeTypes = ["rectangle", "ellipse", "diamond", "rectangle"] as const;
      elements.push({ ...base(`shape-${i}`, i, x, y, 100, 80, { backgroundColor: kind === 1 ? "#a5d8ff" : "transparent" }), type: shapeTypes[kind] });
      continue;
    }

    if (kind === 4) {
      // A bound arrow plus the two shapes it connects — the case that exercises binding recompute on
      // move, which a scene of unconnected shapes would never touch.
      const fromId = `bind-from-${i}`;
      const toId = `bind-to-${i}`;
      const arrowId = `arrow-${i}`;
      elements.push({ ...base(fromId, i, x, y, 90, 60, { boundElements: [{ id: arrowId, type: "arrow" }] }), type: "rectangle" });
      elements.push({ ...base(toId, i + 0.1, x + 130, y, 90, 60, { boundElements: [{ id: arrowId, type: "arrow" }] }), type: "rectangle" });
      elements.push({
        ...base(arrowId, i + 0.2, x + 90, y + 30, 40, 0),
        type: "arrow",
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
        ],
        startBinding: { elementId: fromId, focus: 0, gap: 4 },
        endBinding: { elementId: toId, focus: 0, gap: 4 },
        startArrowhead: "none",
        endArrowhead: "arrow",
        arrowType: "straight",
      });
      i += 2; // this branch produced three elements
      continue;
    }

    if (kind === 5 || kind === 6) {
      elements.push({
        ...base(`text-${i}`, i, x, y, 120, 25, { strokeColor: "#1e1e1e" }),
        type: "text",
        text: `Label ${i}`,
        fontFamily: "normal",
        fontSize: 20,
        textAlign: "left",
        verticalAlign: "top",
        lineHeight: 1.25,
        containerId: null,
      });
      continue;
    }

    // Freehand: a short stroke of 12 samples, jittered by the seeded PRNG so the outlines differ
    // from each other (a cache keyed on identical geometry would otherwise never miss).
    const points: [number, number, number][] = [];
    for (let p = 0; p < 12; p += 1) points.push([p * 8, Math.sin(p / 2) * 10 + random() * 4, 0.5]);
    elements.push({
      ...base(`draw-${i}`, i, x, y, 96, 24),
      type: "freedraw",
      points,
      simulatePressure: true,
    });
  }

  return { elements: elements.slice(0, count) };
}

/** The full multi-page autosave envelope for `elements` — `files: {}` is required by the validator even with no images. */
export function buildAutosaveDocument(elements: Record<string, unknown>[]): unknown {
  return {
    type: "devivadraw/document",
    schemaVersion: 1,
    activePageId: "perf-page",
    pages: [
      {
        id: "perf-page",
        name: "Perf",
        scene: {
          type: "devivadraw/scene",
          schemaVersion: 1,
          elements,
          // Required container even when empty — omitting it fails validation and the scene silently
          // falls back to blank, which reads exactly like a seeding bug that isn't one.
          files: {},
          appState: { scrollX: 0, scrollY: 0, zoom: 1 },
        },
      },
    ],
  };
}

/**
 * Loads `document` by synthesizing a file drop on the canvas — the quota-free path.
 *
 * localStorage caps out around 5 MB, which a 10 000-element scene exceeds (see the audit report),
 * so the largest scale cannot be seeded through the autosave slot at all. Dropping an in-memory
 * `File` goes through the app's real document-import path (`hooks/use-document-file-drop.ts`) with
 * no storage involved, which also happens to be a more realistic "user opens a big board" flow.
 */
export const DROP_SCENE_SCRIPT = `(doc) => {
  const host = document.querySelector('[data-testid="deviva-draw-canvas-host"]');
  if (!host) throw new Error("canvas host not found");
  const file = new File([JSON.stringify(doc)], "perf.devivadraw", { type: "application/json" });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  host.dispatchEvent(new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true }));
  host.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
}`;
