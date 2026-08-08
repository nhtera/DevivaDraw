# Phase 06 — Freehand Drawing Tool

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §6 (Freehand)
- Depends on: `phase-03-canvas-renderer-dual-layer-viewport.md`, `phase-04-input-pipeline-and-tools-state-machine.md`

## Overview
- **Priority:** 🔴 blocking (MVP-listed feature)
- **Status:** pending
- Implement the freedraw/pencil tool using perfect-freehand for pressure-sensitive, smoothed ink strokes, including simulated pressure for mouse input (no real pressure signal).

## Key Insights
- perfect-freehand takes an array of `[x, y, pressure]` points and returns an outline polygon — it does not draw anything itself; this phase owns converting pointer-move samples into that point array and rendering the returned outline as a filled path on the canvas.
- Pointer events expose real `pressure` for pen/stylus input (Apple Pencil, Wacom) but report a flat `0.5` for mouse — perfect-freehand's `simulatePressure` option handles the mouse case by inferring pressure from movement speed, must be explicitly enabled when `pointerType === 'mouse'`.
- Freedraw elements store the raw input points (not the computed outline) so the outline can be recomputed if perfect-freehand's algorithm/options change later (e.g. a stroke-width style change) — recomputing from cached raw points, not baking the outline into the element, matches how bound containers/resize will need to re-derive the visual later (phase 10 resize scales freedraw elements too).
- Point sampling rate matters: sampling every `pointermove` event (which can fire faster than 60fps on high-poll-rate mice) is fine for correctness but should be throttled to animation-frame cadence for render, not for point capture (capture all points for fidelity, render at rAF cadence).

## Requirements
- `freedraw-tool.ts`: `ToolHandler` capturing pointer-down→move→up as a raw point array with pressure.
- `FreedrawElement` type: `points: [x, y, pressure][]`, plus base style fields (stroke color, stroke width map to perfect-freehand's `size`/`thinning` options; freedraw has no fill/background).
- perfect-freehand integration: `getStroke(points, options)` → polygon points → rendered as a filled `Path2D`.
- Simulated pressure for non-pen pointer types.
- Live preview while drawing (interactive layer shows the in-progress stroke; committed to `Scene` only on pointer-up — mid-stroke should not pollute history with intermediate states, consistent with phase 02's gesture-batching design).

## Architecture
```
packages/engine/src/tools/freedraw-tool.ts
packages/engine/src/render/freedraw-renderer.ts   getStroke() -> Path2D
packages/engine/src/elements/element-types.ts     + FreedrawElement
```

## Related Code Files
- Create: `packages/engine/src/tools/freedraw-tool.ts`, `.test.ts`
- Create: `packages/engine/src/render/freedraw-renderer.ts`, `.test.ts`
- Modify: `packages/engine/src/elements/element-types.ts` (add `FreedrawElement`)
- Modify: `packages/engine/src/render/rough-renderer.ts` or add sibling dispatcher (freedraw doesn't use rough.js — dispatch by type, not by "everything goes through rough")

## Implementation Steps
1. Add `perfect-freehand` dependency; license notice.
2. Add `FreedrawElement` to the union; bounding box computed from point extents (needed for culling — phase 03's `getVisibleElements` must handle this type, verify it does since culling is bbox-generic).
3. Implement `freedraw-tool.ts`: on gesture start, begin a new point array; on move, append `[x, y, pressure ?? simulatedPressure]`; on end, commit element to `Scene` in one mutation (one history entry).
4. Implement `freedraw-renderer.ts`: call `getStroke(points, {size, thinning, smoothing, streamline, simulatePressure})`, convert returned outline to a `Path2D`, fill with stroke color.
5. Wire live preview: while drawing, interactive layer (phase 03) renders the in-progress stroke from the tool's uncommitted point buffer, not from `Scene` (avoids spamming version bumps mid-gesture).
6. Unit test: simulated pressure kicks in only for `pointerType === 'mouse'`; committed element has correct point count and bbox.

## Todo List
- [ ] perfect-freehand integrated, license noted
- [ ] FreedrawElement type added, culling handles it correctly
- [ ] Freedraw tool captures points + pressure (real and simulated)
- [ ] Live preview renders during drag without committing to history
- [ ] Committed stroke is one history entry, not one per point

## Success Criteria
- Dev harness: draw a freehand stroke with mouse — visibly tapered/pressure-like ink, matches perfect-freehand's known look.
- Unit tests green for pressure simulation branch and single-history-entry-per-stroke behavior.
- Manual: undo after a freedraw stroke removes the whole stroke in one step.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| High-frequency pointermove floods point array on fast/long strokes, bloating scene JSON (persistence/collab payload size) | Medium | Medium | Note now, revisit in phase 11: consider point simplification (e.g. Douglas-Peucker) on commit if payload sizes prove problematic — flagged, not implemented speculatively (YAGNI until measured) |

## Security Considerations
- None (local input only).

## Next Steps
- Blocks: 10 (selection/transform must scale freedraw point arrays, not just bbox), 11 (freedraw points serialize in scene JSON).
- Rollback: additive — revert commit.
