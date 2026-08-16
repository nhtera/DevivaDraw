/**
 * The pure (no Node APIs) half of SVG export: selection resolution + scene→SVG-string rendering.
 * Split from `export-tools.ts` so runtimes without a filesystem (the Cloudflare worker) can render
 * SVG without evaluating `node:fs`/`node:os` at module load; `export-tools.ts` layers file writing
 * and inline-size fallbacks on top for the stdio transport.
 */
import { createRoughGenerator, EmptyExportSelectionError, exportToSvg, findBoundTextRef, isBindableContainer } from "@deviva-draw/engine";
import type { AnyElement, Scene } from "@deviva-draw/engine";
import { ToolError } from "./tool-types";
import type { ToolSession } from "./tool-types";

/**
 * Resolves an explicit selection to live elements in draw order, expanding each selected container
 * to include its bound label — an agent exporting "the box" expects its text to come along.
 * Shared by SVG export and the PNG/screenshot tools.
 */
export function resolveSelection(scene: Scene, selectionIds: readonly string[]): AnyElement[] {
  const wanted = new Set(selectionIds);
  const missing = selectionIds.filter((id) => {
    const element = scene.getElement(id);
    return !element || element.isDeleted;
  });
  if (missing.length > 0) {
    throw new ToolError(`no element(s) with id(s): ${missing.map((id) => `"${id}"`).join(", ")} — use list_elements to see current ids`);
  }
  for (const id of selectionIds) {
    const element = scene.getElement(id);
    if (element && isBindableContainer(element)) {
      const labelRef = findBoundTextRef(element);
      if (labelRef) wanted.add(labelRef.id);
    }
  }
  return scene.getElements().filter((element) => wanted.has(element.id) && !element.isDeleted);
}

export interface SvgRenderInput {
  selectionIds?: string[];
  background?: string;
  embedSceneData?: boolean;
}

/** Renders the session's scene (or a selection) to an SVG string + UTF-8 byte size. */
export function renderSceneSvg(session: ToolSession, input: SvgRenderInput): { svg: string; bytes: number } {
  const scene = session.scene;
  const elements = input.selectionIds !== undefined ? resolveSelection(scene, input.selectionIds) : undefined;
  try {
    const svg = exportToSvg({
      scene,
      roughGenerator: createRoughGenerator(),
      textMeasurer: session.measurer,
      ...(elements !== undefined ? { elements } : {}),
      backgroundColor: input.background ?? null,
      embedSceneData: input.embedSceneData ?? true,
    });
    return { svg, bytes: new TextEncoder().encode(svg).length };
  } catch (error) {
    if (error instanceof EmptyExportSelectionError) {
      throw new ToolError("nothing to export — the scene (or the given selection) has no visible elements");
    }
    throw error;
  }
}
