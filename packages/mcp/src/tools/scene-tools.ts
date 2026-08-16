/**
 * Scene lifecycle tools: new/open/save bridge the in-memory session to `.devivadraw` files;
 * `describe_scene` is the cheap orientation call agents should reach for first; `get_scene_content`
 * is the ONLY tool that returns full scene JSON (token-economy contract — everything else returns
 * summaries).
 */
import { computeExportBounds, serializeScene } from "@deviva-draw/engine";
import { z } from "zod";
import { defineTool, liveElementCount } from "./tool-types";

export const newSceneTool = defineTool({
  name: "new_scene",
  description: "Start a fresh empty scene, discarding the current one (does not touch any file until save_scene). Optionally sets the canvas background color.",
  inputShape: {
    background: z.string().max(64).optional().describe("canvas background CSS color; omit for the theme default"),
  },
  handler: (session, input) => {
    session.newScene();
    if (input.background !== undefined) session.scene.setBackground(input.background);
    return { data: { ok: true, background: input.background ?? null } };
  },
});

export const openSceneTool = defineTool({
  name: "open_scene",
  description: "Open a Deviva Draw file (.devivadraw JSON — single-scene or multi-page document) and make its active page the working scene. Later save_scene calls write back to this file unless given another path.",
  inputShape: {
    path: z.string().min(1).describe("path to the scene/document file"),
  },
  handler: (session, input) => {
    const result = session.openScene(input.path);
    return {
      data: {
        ...result,
        // Surface salvage drops prominently: an agent must know parts of the file were unreadable
        // BEFORE it saves back over the source.
        warning: result.droppedErrors.length > 0 ? "some entries could not be read and were dropped; saving will persist the file without them" : undefined,
      },
    };
  },
});

export const saveSceneTool = defineTool({
  name: "save_scene",
  description: "Save the current document to disk. Uses the file opened by open_scene when no path is given; multi-page documents are written back whole (untouched pages preserved).",
  inputShape: {
    path: z.string().min(1).optional().describe("target file path; defaults to the currently bound file"),
  },
  handler: (session, input) => ({ data: session.saveScene(input.path) }),
});

export const getSceneContentTool = defineTool({
  name: "get_scene_content",
  description: "Return the active page's FULL scene JSON (every element with all properties). Large — prefer describe_scene, list_elements, or search when you only need part of the picture.",
  inputShape: {},
  handler: (session) => ({ data: serializeScene(session.scene) }),
});

export const describeSceneTool = defineTool({
  name: "describe_scene",
  description: "Cheap scene overview: element counts by type, overall bounds, background, bound file, and page info. Call this first to orient yourself.",
  inputShape: {},
  handler: (session) => {
    const scene = session.scene;
    const countsByType: Record<string, number> = {};
    const visible = [];
    for (const element of scene.getElements()) {
      if (element.isDeleted) continue;
      countsByType[element.type] = (countsByType[element.type] ?? 0) + 1;
      if (!scene.isElementHidden(element)) visible.push(element);
    }
    let bounds: { x: number; y: number; width: number; height: number } | null = null;
    if (visible.length > 0) {
      const box = computeExportBounds(visible, 0);
      bounds = { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    return {
      data: {
        filePath: session.filePath,
        pageCount: session.pageCount,
        activePage: { id: session.activePage.id, name: session.activePage.name },
        elementCount: liveElementCount(scene),
        countsByType,
        bounds,
        background: scene.getBackground(),
      },
    };
  },
});

export const sceneTools = [newSceneTool, openSceneTool, saveSceneTool, getSceneContentTool, describeSceneTool];
