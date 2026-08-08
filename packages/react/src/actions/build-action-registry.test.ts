/**
 * Full-registry wiring tests: (1) no duplicate action ids across every builder file, (2) every
 * chrome-level shortcut an `Action` declares actually resolves through a real engine
 * `ShortcutRegistry` built the same way `runtime/build-runtime.ts` builds one — this is the "full
 * keyboard shortcut map populated and verified" success criterion made into a real regression test
 * rather than a manual checklist, and (3) a real end-to-end exercise of a handful of actions against
 * a real `Scene`/`SelectionState`/`HistoryStack`, proving the registry's wiring — not just its
 * dispatch mechanics (already covered in `action-registry.test.ts`) — actually mutates the engine
 * correctly.
 */
import {
  createRectangleElement,
  HistoryStack,
  InternalClipboard,
  registerFullShortcutMap,
  Scene,
  SelectionState,
  ShapeStyleState,
  ShortcutRegistry,
} from "@deviva-draw/engine";
import type { AnyElement } from "@deviva-draw/engine";
import { describe, expect, it, vi } from "vitest";
import { buildActionRegistry } from "./build-action-registry";
import type { ActionRuntime } from "./action-types";

/** Action ids whose shortcut is expected to resolve via the engine's `ShortcutRegistry` — every tool switch, undo/redo, zoom, and the command palette. Everything else is intentionally handled inside the select tool's own `onKeyDown` (see `edit-actions.ts`/`arrange-actions.ts`/`z-order-actions.ts` doc comments) and is NOT expected to resolve here. */
const CHROME_REGISTRY_ACTION_IDS = new Set([
  "select-tool",
  "pan-tool",
  "rectangle-tool",
  "ellipse-tool",
  "diamond-tool",
  "line-tool",
  "arrow-tool",
  "freedraw-tool",
  "text-tool",
  "undo",
  "redo",
  "zoom-in",
  "zoom-out",
  "zoom-to-fit",
  "open-command-palette",
]);

function parseCombo(combo: string): { key: string; modifiers: { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean } } {
  const tokens = combo.split("+");
  const key = tokens.at(-1)!;
  return {
    key,
    modifiers: { shift: tokens.includes("shift"), alt: tokens.includes("alt"), ctrl: tokens.includes("ctrl"), meta: tokens.includes("meta") },
  };
}

describe("buildActionRegistry", () => {
  it("registers every action with a unique id (no duplicate-id warnings)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildActionRegistry();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("every action's declared shortcut for a chrome-level id resolves through a real ShortcutRegistry to that same action id", () => {
    const actionRegistry = buildActionRegistry();
    const shortcutRegistry = new ShortcutRegistry();
    registerFullShortcutMap(shortcutRegistry);

    for (const id of CHROME_REGISTRY_ACTION_IDS) {
      const action = actionRegistry.get(id);
      expect(action, `expected a "${id}" action to be registered`).toBeDefined();
      expect(action!.shortcut, `expected "${id}" to declare a display shortcut`).toBeDefined();
      const { key, modifiers } = parseCombo(action!.shortcut!);
      // `meta+=`/`meta+-` are registered under both ctrl and meta in the engine registry (see
      // `registerCoreShortcuts`); resolving via meta (this test's declared shortcut) is sufficient.
      expect(shortcutRegistry.resolve(key, modifiers), `"${action!.shortcut}" should resolve to "${id}"`).toBe(id);
    }
  });

  it("tool-handled actions (copy/paste/duplicate/delete/group/lock/z-order) are NOT registered in the engine ShortcutRegistry — they reach the select tool's own onKeyDown instead", () => {
    const shortcutRegistry = new ShortcutRegistry();
    registerFullShortcutMap(shortcutRegistry);

    expect(shortcutRegistry.resolve("c", { shift: false, alt: false, ctrl: false, meta: true })).toBeUndefined();
    expect(shortcutRegistry.resolve("d", { shift: false, alt: false, ctrl: false, meta: true })).toBeUndefined();
    expect(shortcutRegistry.resolve("g", { shift: false, alt: false, ctrl: false, meta: true })).toBeUndefined();
  });
});

function buildTestRuntime(scene: Scene): ActionRuntime {
  const selection = new SelectionState();
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  return {
    scene,
    selection,
    history,
    clipboard: new InternalClipboard(),
    styleState: new ShapeStyleState(),
    toolStateMachine: { setTool: vi.fn(() => true) } as unknown as ActionRuntime["toolStateMachine"],
    panZoomTool: { zoomStep: vi.fn(), zoomToFit: vi.fn() } as unknown as ActionRuntime["panZoomTool"],
    editSession: {} as ActionRuntime["editSession"],
    getCamera: () => ({ scrollX: 0, scrollY: 0, zoom: 1 }),
    getViewportSize: () => ({ width: 800, height: 600 }),
    grid: { enabled: false, size: 20 },
    ui: {
      getZenMode: () => false,
      setZenMode: vi.fn(),
      getViewOnly: () => false,
      setViewOnly: vi.fn(),
      getStatsPanelVisible: () => false,
      setStatsPanelVisible: vi.fn(),
      getCommandPaletteOpen: () => false,
      setCommandPaletteOpen: vi.fn(),
      getShortcutsDialogOpen: () => false,
      setShortcutsDialogOpen: vi.fn(),
      getShareDialogState: () => ({ status: "closed" as const }),
      setShareDialogState: vi.fn(),
    },
    theme: { mode: "light", toggleMode: vi.fn() },
    persistence: {
      newScene: vi.fn(),
      openScene: vi.fn(),
      saveScene: vi.fn(),
      exportPng: vi.fn(),
      exportSvg: vi.fn(),
      copyAsImage: vi.fn(),
      shareScene: vi.fn(async () => "https://draw.deviva.app/s/test#key=k&iv=i"),
    },
  };
}

describe("buildActionRegistry — end-to-end against a real Scene", () => {
  it("select-all then delete then undo round-trips a real element through the registry", () => {
    const scene = new Scene();
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const registry = buildActionRegistry();
    const runtime = buildTestRuntime(scene);

    registry.run("select-all", runtime);
    expect(runtime.selection.getSelectedIds().has(el.id)).toBe(true);

    registry.run("delete", runtime);
    expect(scene.getElement(el.id)?.isDeleted).toBe(true);

    registry.run("undo", runtime);
    expect(scene.getElement(el.id)?.isDeleted).toBe(false);
  });

  it("duplicate creates a new element and selects it", () => {
    const scene = new Scene();
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const registry = buildActionRegistry();
    const runtime = buildTestRuntime(scene);
    runtime.selection.selectOnly([el.id]);

    registry.run("duplicate", runtime);

    expect(scene.getElements()).toHaveLength(2);
    const newId = [...runtime.selection.getSelectedIds()][0];
    expect(newId).not.toBe(el.id);
  });

  it("delete is disabled (a no-op) with an empty selection", () => {
    const scene = new Scene();
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const registry = buildActionRegistry();
    const runtime = buildTestRuntime(scene);

    registry.run("delete", runtime);

    expect(scene.getElement(el.id)?.isDeleted).toBe(false);
  });
});
