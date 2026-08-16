/**
 * `read_scene_format` — docs-as-a-tool (the competitor-validated pattern): a static cheat-sheet the
 * agent can pull on demand instead of guessing at the element model. Content is maintained BY HAND
 * against `element-schemas.ts`; the docs test asserts the tool names it mentions exist so it can't
 * silently rot.
 */
import { defineTool } from "./tool-types";

const FORMAT_GUIDE = `# Deviva Draw scene format — agent cheat-sheet

## Coordinate system
- Infinite canvas, scene units ≈ CSS px at zoom 1. +x right, +y down.
- Every element has (x, y) = TOP-LEFT of its bounding box, plus width/height.
- "angle" is rotation in radians around the box center.
- line/arrow/freedraw carry "points" RELATIVE to their own (x, y); the first point is the
  tail/start. Points are auto-normalized so their bounding box starts at (0, 0).

## Element types
- Shapes: rectangle, ellipse, diamond, note (sticky note), frame (named grouping region).
- Connectors: arrow (arrowheads/curved/elbow), line (repeat first point last to close a polygon).
- Text: standalone "text" elements, or a "label" bound INSIDE a shape (auto-wrapped + centered).
- freedraw: ink strokes from sample points.

## Styling
- strokeColor/backgroundColor: CSS colors; backgroundColor "transparent" for outline-only.
- fillStyle: hachure | cross-hatch | solid | zigzag (hand-drawn fills).
- roughness 0–3: 0 = clean lines, higher = sketchier. strokeStyle: solid | dashed | dotted.
- opacity 0–100. Default look is hand-drawn (sketchy outlines, hand-drawn font).

## Working efficiently (do this)
1. describe_scene first — counts, bounds, background.
2. search_scene_content / list_elements to locate ids — get_scene_content is the ONLY full dump;
   avoid it unless you truly need every property.
3. create_elements / update_elements batch up to 100 per call; keep returned ids.
4. Diagrams: prefer create_diagram (nodes+edges) or create_diagram_from_mermaid over placing
   shapes by hand — both auto-layout and bind arrows.
5. take_screenshot after drawing to SEE your result and fix overlaps before finishing.
6. export_svg / export_png embed the scene JSON, so exported files re-open fully editable.

## Labels vs text
- To put text in a shape: pass "label" on the shape (create or update) — never create a separate
  text element on top of it.
- Standalone text: type "text" with a "text" property. Updating text re-measures its box.`;

export const readSceneFormatTool = defineTool({
  name: "read_scene_format",
  description: "Read the scene-format cheat-sheet: coordinate system, element types, styling, and the efficient tool-usage patterns for this server. Call once before building anything non-trivial.",
  inputShape: {},
  handler: () => ({ data: { guide: FORMAT_GUIDE } }),
});

export const formatGuideTools = [readSceneFormatTool];
