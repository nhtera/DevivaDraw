# More Tools + Overflow Menu — Competitor Parity

Goal: add the "More" overflow menu (tldraw icon-grid popover style) and the tools deviva-draw is still
missing vs Excalidraw/tldraw. Keep the main toolbar decluttered; house secondary/new tools in the popover.

## Scope (confirmed with user 2026-08-10)
- More overflow menu — **icon-grid popover** (tldraw style), opened by a `⌄` button at the toolbar end.
- Highlighter tool — translucent thick marker (freedraw variant, multiply blend).
- Extra shapes — triangle, hexagon, star (new bounding-box shape types).
- Lasso select — free-form loop selection (separate tool, feeds selection).
- Frame tool — draw named regions; contained elements move with the frame.

Out of scope: Web Embed, Draw-to-shape, Bucket fill, AI generate (Excalidraw-only advanced/AI).

## Architecture notes (from scout)
- Shapes: `shape-elements.ts` (bbox types) + `rough-shape-geometry.ts` (vertices) + `rough-renderer.ts`
  (dispatch) + `hit-test.ts` (polygon hit via `polygon-hit-math.ts`) + `drag-shape-tool-base.ts` (tool).
  New polygon shapes reuse the diamond pattern; add a shared unit-vertex helper for tri/hex/star.
- Highlighter: add `highlighter?: boolean` to `FreedrawElement`; `freedraw-tool.ts` gains a flag;
  `freedraw-renderer.ts` renders highlighter with constant thick size, no pressure taper, `multiply`
  compositing + translucency. HighlighterTool = FreedrawTool with the flag (no new tool class body).
- Lasso: new `LassoTool` records a polygon path, renders live on interactive layer, selects via
  `elementsInLasso` (corner/center inside polygon). Runtime exposes `getLassoPath()`.
- Frame: new `FrameElement` type + renderer (subtle border + name label) + hit-test; `FrameTool`
  drag-to-create; `MoveGesture.begin` expands moving set to frame-contained ids so children move along.
- More menu: React popover grid (`more-tools-menu.tsx`), fed by a `MORE_TOOL_IDS` list; toolbar keeps
  primary tools, popover holds highlighter/laser/lasso/frame + extra shapes.

## Phases
1. Highlighter (engine + render + wiring + tests)
2. Extra shapes: triangle, hexagon, star (engine + render + hit-test + tools + wiring + tests)
3. Lasso select (engine tool + interactive render + runtime + wiring + tests)
4. Frame tool (engine element + render + hit-test + tool + move-together + wiring + tests)
5. More overflow menu popover (React) + toolbar declutter + relocate secondary tools + e2e
6. Gate: engine/react/collab unit + web e2e + lint; live verify; commit each phase.

## Success criteria
- Each new tool reachable from the More popover, selectable, draws/behaves like the competitor.
- Frame children translate with the frame on drag; one undo step per gesture.
- No regressions: full test gate green; lint clean.
