/**
 * Content search — the "look before you dump" tool the token-economy contract points agents at.
 * Wraps the engine's `findTextMatches` (the same matcher behind the app's find-on-canvas: standalone
 * text, shape/note labels, table cells) and joins each hit back to the element that visually carries
 * it (a label match reports its container, which is the id an agent wants to move/style/delete).
 */
import { findTextMatches } from "@deviva-draw/engine";
import { z } from "zod";
import { defineTool, summarizeElement } from "./tool-types";
import type { ElementSummary } from "./tool-types";

const MAX_RESULTS = 100;

export const searchSceneContentTool = defineTool({
  name: "search_scene_content",
  description:
    "Find elements whose text contains the query (case-insensitive; covers standalone text, shape/note labels, and table cells). Returns element summaries — text matches inside a shape's label report the shape itself. Use this instead of get_scene_content to locate things.",
  inputShape: {
    query: z.string().min(1).max(500),
    type: z.string().optional().describe("only report matches on elements of this type (after label→container resolution)"),
  },
  handler: (session, input) => {
    const scene = session.scene;
    const seen = new Set<string>();
    const matches: ElementSummary[] = [];
    for (const id of findTextMatches(scene, input.query)) {
      const element = scene.getElement(id);
      if (!element) continue;
      // A bound label match is more useful reported as its container — that's the element the
      // agent will act on. Standalone text reports itself.
      const carrier = element.type === "text" && element.containerId !== null ? (scene.getElement(element.containerId) ?? element) : element;
      if (seen.has(carrier.id)) continue;
      seen.add(carrier.id);
      if (input.type !== undefined && carrier.type !== input.type) continue;
      matches.push(summarizeElement(carrier, scene));
    }
    return {
      data: {
        total: matches.length,
        matches: matches.slice(0, MAX_RESULTS),
        truncated: matches.length > MAX_RESULTS ? `showing first ${MAX_RESULTS}` : undefined,
      },
    };
  },
});

export const searchTools = [searchSceneContentTool];
