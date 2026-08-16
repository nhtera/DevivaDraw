/**
 * SVG export tool for the stdio transport: the pure renderer (`svg-render.ts`) plus file writing
 * and the inline-size fallback. Output embeds the live scene JSON in `<metadata>` by default so an
 * exported file re-opens as an editable scene in the web app. PNG lives in `screenshot-tools.ts`.
 */
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "./tool-types";
import type { ToolSession } from "./tool-types";
import { renderSceneSvg } from "./svg-render";

export { resolveSelection } from "./svg-render";

/** Above this, an inline SVG string would blow the agent's context — fall back to a file. */
const INLINE_SVG_CAP_BYTES = 1_000_000;

export interface SvgExportOutcome {
  data: { path?: string; svg?: string; bytes: number; note?: string };
}

export function runSvgExport(
  session: ToolSession,
  input: { path?: string; selectionIds?: string[]; background?: string; embedSceneData?: boolean },
): SvgExportOutcome {
  const { svg, bytes } = renderSceneSvg(session, input);

  if (input.path !== undefined) {
    const target = session.resolvePath(input.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, svg, "utf8");
    return { data: { path: target, bytes } };
  }
  if (bytes > INLINE_SVG_CAP_BYTES) {
    // File-fallback rather than flooding the model's context with a megabyte of markup.
    const fallback = join(tmpdir(), `deviva-draw-export-${Date.now()}.svg`);
    writeFileSync(fallback, svg, "utf8");
    return { data: { path: fallback, bytes, note: "SVG exceeded the inline size cap and was written to a file instead — pass \"path\" to choose the location" } };
  }
  return { data: { svg, bytes } };
}

export const exportSvgTool = defineTool({
  name: "export_svg",
  description:
    "Export the scene (or a selection) as an SVG that renders exactly like the canvas. Embeds the scene JSON by default so the file re-opens as an editable scene in the Deviva Draw app. Returns the SVG inline, or writes to \"path\" when given (large outputs always go to a file).",
  inputShape: {
    path: z.string().min(1).optional().describe("write the SVG here instead of returning it inline"),
    selectionIds: z.array(z.string().min(1)).min(1).max(500).optional().describe("export only these elements (labels of selected shapes are included automatically)"),
    background: z.string().max(64).optional().describe("background fill CSS color; omit for transparent"),
    embedSceneData: z.boolean().optional().describe("embed editable scene JSON in the SVG (default true)"),
  },
  handler: (session, input) => runSvgExport(session, input),
});

export const exportTools = [exportSvgTool];
