/**
 * Element CRUD tools. Batches are capped at 100 per call; update/delete batches are validated
 * whole-batch BEFORE the first mutation lands, so a rejected call never leaves the scene
 * half-changed (creates need only schema validation today — nothing after it can reject). All
 * mutations go through `Scene.updateElement`/`addElement` (engine `touch()` path) — versioning and
 * collab invariants can't be bypassed from here. Results are token-economy summaries, never full
 * elements.
 */
import { deleteContainerAndBoundText, findBoundTextRef, growContainerToFitText, isBindableContainer, unbindTextFromContainer } from "@deviva-draw/engine";
import type { AnyElement, ElementUpdate, Scene, TextMeasurer } from "@deviva-draw/engine";
import { z } from "zod";
import { applyLabel, insertElementFromInput, measureStandaloneText, normalizePoints } from "./element-create";
import { createElementSchema, updateElementSchema } from "./element-schemas";
import type { UpdateElementInput } from "./element-schemas";
import { defineTool, summarizeElement, ToolError } from "./tool-types";

const MAX_BATCH = 100;

export const createElementsTool = defineTool({
  name: "create_elements",
  description:
    "Create up to 100 elements in one call (rectangle, ellipse, diamond, note, frame, line, arrow, text, freedraw). Shapes accept a \"label\" that is bound inside them and auto-wrapped. Returns {id, type, x, y, width, height} summaries — keep the ids to edit later.",
  inputShape: {
    elements: z.array(createElementSchema).min(1).max(MAX_BATCH),
  },
  handler: (session, input) => {
    const summaries = input.elements.map((element) => summarizeElement(insertElementFromInput(session.scene, element, session.measurer), session.scene));
    return { data: { created: summaries } };
  },
});

/** Style/orientation fields an update may carry, applied verbatim through the engine whitelist. */
const DIRECT_UPDATE_FIELDS = ["x", "y", "width", "height", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "angle", "locked"] as const;

/** Point-geometry types whose vertex list (and derived box) `points` may replace. */
const POINTED_TYPES = new Set(["line", "arrow", "freedraw"]);

/** Validates one update against its target's type — throws the agent-facing error naming id, type, and fix. */
function checkUpdate(update: UpdateElementInput, element: AnyElement): void {
  if (update.text !== undefined && element.type !== "text") {
    throw new ToolError(`element "${update.id}" is a ${element.type}, not text — use "label" for shapes, or target the text element itself`);
  }
  if (update.label !== undefined && !isBindableContainer(element)) {
    throw new ToolError(`element "${update.id}" is a ${element.type} and cannot carry a label — labels apply to rectangle/ellipse/diamond/note`);
  }
  if (update.points !== undefined && !POINTED_TYPES.has(element.type)) {
    throw new ToolError(`element "${update.id}" is a ${element.type} — "points" applies only to line/arrow/freedraw`);
  }
}

function applyUpdate(scene: Scene, update: UpdateElementInput, element: AnyElement, measurer: TextMeasurer): void {
  const changes: ElementUpdate = {};
  for (const field of DIRECT_UPDATE_FIELDS) {
    if (update[field] !== undefined) (changes as Record<string, unknown>)[field] = update[field];
  }
  if (update.points !== undefined) {
    const normalized = normalizePoints(update.points);
    changes.x = (update.x ?? element.x) + normalized.dx;
    changes.y = (update.y ?? element.y) + normalized.dy;
    changes.width = normalized.width;
    changes.height = normalized.height;
    (changes as Record<string, unknown>).points =
      element.type === "freedraw" ? normalized.points.map((point) => [point.x, point.y, 0.5]) : normalized.points;
  }
  if (update.text !== undefined && element.type === "text") {
    (changes as Record<string, unknown>).text = update.text;
    if (element.containerId === null) {
      // Standalone text: re-derive the block's natural size for the new content.
      const size = measureStandaloneText(update.text, element.fontSize, element.fontFamily, measurer);
      changes.width = size.width;
      changes.height = size.height;
    }
  }
  if (Object.keys(changes).length > 0) scene.updateElement(update.id, changes);
  if (update.text !== undefined && element.type === "text" && element.containerId !== null) {
    // Bound label edited directly: re-wrap and grow its container, same as a committed edit session.
    growContainerToFitText(scene, element.containerId, update.text, measurer);
  }
  if (update.label !== undefined) {
    growContainerToFitText(scene, update.id, update.label, measurer);
  }
}

export const updateElementsTool = defineTool({
  name: "update_elements",
  description:
    "Update up to 100 elements in one call. Mutable: position/size, style, angle, opacity, locked, \"text\" (text elements), \"label\" (shapes), \"points\" (line/arrow/freedraw). The whole batch is validated before anything is applied.",
  inputShape: {
    updates: z.array(updateElementSchema).min(1).max(MAX_BATCH),
  },
  handler: (session, input) => {
    const scene = session.scene;
    const resolved = input.updates.map((update) => {
      const element = scene.getElement(update.id);
      if (!element || element.isDeleted) throw new ToolError(`no element with id "${update.id}" — use list_elements to see current ids`);
      checkUpdate(update, element);
      // A label update on a container without a bound text yet must create one — reuse the create path.
      if (update.label !== undefined && findBoundTextRef(element) === null) return { update, element, needsLabelCreate: true };
      return { update, element, needsLabelCreate: false };
    });
    for (const { update, element, needsLabelCreate } of resolved) {
      // A label update on a container without a bound text yet creates one first, so
      // `growContainerToFitText` inside `applyUpdate` has a target.
      if (needsLabelCreate) applyLabel(scene, element.id, update.label ?? "", session.measurer);
      // Re-fetch rather than reusing the validation pass's snapshot: `updateElement` returns a NEW
      // frozen object every call, so a later batch entry targeting the same id must see the earlier
      // entries' changes, not the pre-batch state.
      const current = scene.getElement(update.id) ?? element;
      applyUpdate(scene, update, current, session.measurer);
    }
    const summaries = resolved.map(({ update }) => {
      const element = scene.getElement(update.id);
      return element ? summarizeElement(element, scene) : { id: update.id };
    });
    return { data: { updated: summaries } };
  },
});

export const deleteElementsTool = defineTool({
  name: "delete_elements",
  description: "Delete up to 100 elements by id. Deleting a labeled shape removes its label too; deleting a bound label detaches it from its shape.",
  inputShape: {
    ids: z.array(z.string().min(1)).min(1).max(MAX_BATCH),
  },
  handler: (session, input) => {
    const scene = session.scene;
    const missing = input.ids.filter((id) => {
      const element = scene.getElement(id);
      return !element || element.isDeleted;
    });
    if (missing.length > 0) {
      throw new ToolError(`no element(s) with id(s): ${missing.map((id) => `"${id}"`).join(", ")} — nothing was deleted; use list_elements to see current ids`);
    }
    for (const id of input.ids) {
      const element = scene.getElement(id);
      if (!element || element.isDeleted) continue; // an earlier delete in this batch may have cascaded here
      if (isBindableContainer(element) && findBoundTextRef(element) !== null) {
        deleteContainerAndBoundText(scene, id);
      } else {
        if (element.type === "text" && element.containerId !== null) unbindTextFromContainer(scene, element.containerId, id);
        scene.deleteElement(id);
      }
    }
    return { data: { deleted: input.ids } };
  },
});

const DEFAULT_LIST_LIMIT = 50;

export const listElementsTool = defineTool({
  name: "list_elements",
  description: "List element summaries ({id, type, x, y, width, height, label}) in draw order, optionally filtered by type. Paginate with limit/offset. Cheap — use this instead of get_scene_content.",
  inputShape: {
    type: z.string().optional().describe("only elements of this type (e.g. \"rectangle\", \"arrow\", \"text\")"),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  },
  handler: (session, input) => {
    const scene = session.scene;
    const all = scene.getElements().filter((element) => !element.isDeleted && (input.type === undefined || element.type === input.type));
    const offset = input.offset ?? 0;
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const page = all.slice(offset, offset + limit);
    return {
      data: {
        total: all.length,
        offset,
        elements: page.map((element) => summarizeElement(element, scene)),
      },
    };
  },
});

export const elementTools = [createElementsTool, updateElementsTool, deleteElementsTool, listElementsTool];
