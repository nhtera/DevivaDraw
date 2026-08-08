# Phase 05 — Shape Tools & Style System

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §2 (Tools & Shapes — sketchy rendering, style system)
- Depends on: `phase-03-canvas-renderer-dual-layer-viewport.md`, `phase-04-input-pipeline-and-tools-state-machine.md`

## Overview
- **Priority:** 🔴 blocking — first tools that produce real user-visible output; unblocks dogfooding
- **Status:** pending
- Implement rectangle, ellipse, diamond, and line/polyline tools with rough.js sketchy rendering and the full style system (stroke/background color, fill style, stroke width/style, opacity, roundness, per-element random seed).

## Key Insights
- rough.js seed must be generated once at element creation and stored on the element (`seed` field already in phase 02's base type) — re-rolling the seed on every redraw makes the sketchy look "jitter," which is the single most noticeable "cheap clone" tell.
- Fill styles (hachure/cross-hatch/solid/zigzag) are rough.js's native fill options — no custom implementation needed, just pass-through configuration mapping.
- "Keep current styles for next shape": the last-used style set is cached in tool state (not per-element default) so drawing shape #2 inherits shape #1's stroke color until explicitly changed — a UX detail users notice immediately if missing.
- Line/polyline tool is multi-point (click to add points, double-click/Enter/Escape to finish, supports closing into a polygon by clicking near the start point) — meaningfully more complex than the single-drag rect/ellipse/diamond tools; budget it as its own implementation step, not "just another shape."
- This phase's `ToolHandler` implementations are the first real consumers of phase 04's interface — validates that interface design before 3 more tool phases build on it.

## Requirements
- Rectangle/ellipse/diamond tools: drag-to-create (shift = 1:1 aspect lock, alt = grow from center — both are input-layer modifier reads, not renderer concerns).
- Line/polyline tool: click-to-add-point, closes into polygon near start point, Enter/double-click/Escape to finish.
- rough.js integration: one `drawElementRough(ctx, element, roughCanvas)` dispatch per element type, replacing phase 03's placeholder box renderer.
- Style system: `strokeColor, backgroundColor, fillStyle (hachure|cross-hatch|solid|zigzag), strokeWidth (thin|bold|extra-bold), strokeStyle (solid|dashed|dotted), opacity (0-100), roundness (sharp|round), sloppiness (architect|artist|cartoonist — rough.js's 3 levels)`.
- Style picker data model (no UI yet — UI chrome is phase 12): a `currentStyle` object in tool state, applied to new elements, mutable via engine API that phase 12's color pickers will call.
- Color palette + custom hex + "recently used" list (data model only this phase — `RecentColors` ring buffer in engine state; rendering the picker UI is phase 12).

## Architecture
```
packages/engine/src/tools/
├── rectangle-tool.ts
├── ellipse-tool.ts
├── diamond-tool.ts
├── line-tool.ts              (multi-point, most complex)
└── shape-style-state.ts       currentStyle + recentColors
packages/engine/src/render/
├── rough-renderer.ts           rough.js dispatch per element type (replaces draw-element-placeholder.ts)
```
rough.js is added as a dependency of `packages/engine` only (not react/collab-client) — rendering stays engine-owned.

## Related Code Files
- Create: `packages/engine/src/tools/rectangle-tool.ts`, `ellipse-tool.ts`, `diamond-tool.ts`, `line-tool.ts` (+ `.test.ts` each)
- Create: `packages/engine/src/tools/shape-style-state.ts`, `.test.ts`
- Create: `packages/engine/src/render/rough-renderer.ts`, `.test.ts`
- Modify: `packages/engine/src/render/static-layer.ts` (call `rough-renderer` instead of placeholder)
- Delete: `packages/engine/src/render/draw-element-placeholder.ts` (superseded)
- Modify: `packages/engine/src/elements/element-types.ts` (add concrete `RectangleElement | EllipseElement | DiamondElement | LineElement` to the union)

## Implementation Steps
1. Add `roughjs` dependency; add its MIT notice to `LICENSE-THIRD-PARTY`.
2. Extend element union with concrete shape types (rect/ellipse/diamond/line), each carrying the style fields from Requirements.
3. Implement `rough-renderer.ts`: one function per element type calling the appropriate `roughCanvas.rectangle/ellipse/polygon` API, passing `seed` for stability.
4. Implement `rectangle-tool.ts`/`ellipse-tool.ts`/`diamond-tool.ts` as `ToolHandler`s: drag creates element with `currentStyle` snapshot + fresh random seed, shift/alt modifiers adjust dimensions live during drag.
5. Implement `line-tool.ts`: multi-point state machine (separate from single-drag tools — click adds point, tracks polygon-close proximity to first point, Enter/Escape/double-click commits).
6. Implement `shape-style-state.ts`: holds `currentStyle`, exposes `setStyle(partial)` (used by new shapes) and `applyToSelection(partial)` (stubbed — real selection exists phase 10, wire the call site now, implement the "apply to selected elements" branch in phase 10).
7. Wire all 4 tools into `ToolStateMachine` registry from phase 04; register tool-switch shortcuts (`R`, `O`, `D`, `L`/`A` matching Excalidraw's letter conventions since that's the muscle-memory users expect, not a trademark issue — shortcuts aren't copyrightable).
8. Golden/seeded rough.js render test: same element + same seed → pixel-identical output across two renders (regression guard for the "seed re-rolls on redraw" bug class).

## Todo List
- [ ] rough.js integrated, license noted
- [ ] Rectangle/ellipse/diamond tools implemented, drag + shift/alt modifiers work
- [ ] Line/polyline tool implemented (multi-point, polygon close, all 3 finish methods)
- [ ] Style system fields on elements, `currentStyle` persists across shape creations
- [ ] Fill styles (hachure/cross-hatch/solid/zigzag) all render correctly
- [ ] Seed stability regression test passing
- [ ] Static layer renders real shapes (placeholder renderer removed)

## Success Criteria
- Dev harness: draw a rectangle, ellipse, diamond, and closed polygon; each looks visibly "sketchy" (rough.js) and matches the last-set style.
- Unit tests: seed stability, style-state persistence across creations, modifier-key math (shift aspect lock, alt center-grow) — numeric assertions, not visual.
- No console errors drawing 200+ mixed shapes at once (perf smoke check, formal perf budget deferred to later polish).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| rough.js perf cost at high element counts undermines phase 03's culling/caching gains | Medium | Medium | Static-layer caching (phase 03) already amortizes this — redraw only on change, not per frame; add an element-count perf test as a checkpoint before phase 10 |
| Line tool's multi-point state machine has edge cases (rapid clicks, click-drag hybrid) | Medium | Low | Explicit state machine (not ad-hoc flags, consistent with phase 04's FSM approach) + dedicated unit tests for each finish path |

## Security Considerations
- None (no external input parsing).

## Next Steps
- Blocks: 07 (containers bind text to these shapes), 08 (arrows bind endpoints to these shapes), 10 (selection/transform operates on these element types).
- Rollback: additive tool set — revert commit; no persisted user data yet (phase 11 is first persistence).
