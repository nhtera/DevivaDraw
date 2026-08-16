/**
 * The complete shared tool core — one flat registry both transports consume (stdio here in
 * `../stdio.ts`; the stateless Cloudflare worker in Phase 3). Adding a tool = adding it to one of
 * the category modules; transports never enumerate tools themselves.
 */
import type { McpToolDef } from "./tool-types";
import { sceneTools } from "./scene-tools";
import { elementTools } from "./element-tools";
import { diagramTools } from "./diagram-tools";
import { exportTools } from "./export-tools";
import { screenshotTools } from "./screenshot-tools";
import { searchTools } from "./search-tools";
import { formatGuideTools } from "./format-guide";

export const allTools: readonly McpToolDef[] = [...sceneTools, ...elementTools, ...diagramTools, ...searchTools, ...exportTools, ...screenshotTools, ...formatGuideTools];
