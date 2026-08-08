# Phase 08 — Arrows & Element Bindings

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §4 (Arrows & Bindings — "hardest single subsystem")
- `deviva/apps/web/components/read-tldraw-diagram.ts` + `extract-canvas-diagram.ts` (`CanvasArrowBindingInput { fromId, toId, terminal }`, `buildEdges` direction-from-arrowheads logic — this phase's binding model must map cleanly onto that exact contract since it's what phase 15's scene-read API has to reproduce)
- Depends on: `phase-05-shape-tools-and-style-system.md`, `phase-07-text-editing-and-bound-containers.md`

## Overview
- **Priority:** 🟡 parity-critical, flagged by research as the hardest single subsystem — budget accordingly, don't compress this phase's timeline
- **Status:** pending
- Implement arrow/connector elements that bind to shape endpoints, auto-reroute and clip at shape borders on move/resize, support straight/curved/elbow variants and 5 arrowhead styles, and carry optional centered text labels.

## Key Insights
- Binding is a **graph relationship**, not a geometric coincidence: an arrow endpoint stores `{elementId, focus, gap}` (which element it's bound to, where along that element's border, and a gap offset) in a `startBinding`/`endBinding` field on the arrow element, and the target element's `boundElements` array (phase 02) lists the arrow back — bidirectional for O(1) "what's bound to this shape" lookups needed when that shape moves.
- Rerouting on move: when a bound shape moves/resizes, its `updateElement` call (phase 02) must trigger a **binding-recompute pass** for every arrow in its `boundElements` — recompute the arrow's endpoint position by intersecting a line from the arrow's other endpoint (or last direction) with the shape's boundary, clipped at the border edge (not the bounding box corner, unless the shape is a rectangle — ellipse/diamond need shape-specific border intersection math).
- This recompute pass is the piece collab (phase 14) will later have to make idempotent/mergeable — keep it a pure function `recomputeBinding(arrow, boundElement) -> newEndpoint` so it can be re-run safely on either the local client or when applying a remote update, without side effects beyond the one arrow.
- Elbow arrows (orthogonal routing) are meaningfully harder than straight/curved — treat as a distinct rendering+routing mode selected per-arrow, not a style variant bolted onto the straight-arrow path. If time pressure hits, straight+curved+bindings+labels is the MVP-critical subset; elbow routing can slip within this phase's own todo list without blocking phase 09+ (call this out explicitly to avoid the whole phase stalling on the hardest sub-feature).
- Bound labels (arrow text) reuse phase 07's `bound-text.ts`/`get-label.ts` machinery — the label's position is recomputed to stay centered on the arrow's current midpoint after any reroute, same "recompute on change" pattern as endpoint binding.

## Requirements
- `ArrowElement`: `points (multi-point path), startBinding?, endBinding?, startArrowhead, endArrowhead (none|arrow|bar|dot|triangle), arrowType (straight|curved|elbow), labelElementId?`.
- Arrow tool: click-drag for straight two-point arrow; multi-point mode (click to add points, matching line tool's UX from phase 05) for curved arrows.
- Binding on create: dragging an arrow endpoint near a shape's border (within a hover/snap threshold) binds to that shape; dropping in empty space leaves it unbound.
- Rerouting: moving/resizing a bound shape recomputes every bound arrow's endpoint(s) via `recomputeBinding`.
- Clipping: arrow visually stops at the shape's border (with configurable `gap`), not drawn overlapping into the shape.
- Arrowhead rendering: 5 styles × 2 ends, independently configurable.
- Bound label: double-click an arrow to add/edit a centered text label (reuses phase 07 bound-text machinery), repositions on reroute.

## Architecture
```
packages/engine/src/bindings/
├── binding-model.ts          startBinding/endBinding types, boundElements bookkeeping
├── recompute-binding.ts       pure fn: shape moved/resized -> new arrow endpoint(s)
└── shape-border-intersection.ts   per-shape-type border intersection math (rect/ellipse/diamond)
packages/engine/src/tools/arrow-tool.ts
packages/engine/src/render/arrow-renderer.ts   arrowhead shapes, elbow routing, curved path
```

## Related Code Files
- Create: `packages/engine/src/bindings/binding-model.ts`, `.test.ts`
- Create: `packages/engine/src/bindings/recompute-binding.ts`, `.test.ts`
- Create: `packages/engine/src/bindings/shape-border-intersection.ts`, `.test.ts`
- Create: `packages/engine/src/tools/arrow-tool.ts`, `.test.ts`
- Create: `packages/engine/src/render/arrow-renderer.ts`, `.test.ts`
- Modify: `packages/engine/src/elements/element-types.ts` (add `ArrowElement`)
- Modify: `packages/engine/src/scene/scene.ts` (hook: on `updateElement` for a bound-to element, trigger `recomputeBinding` for its `boundElements` arrows)

## Implementation Steps
1. Add `ArrowElement` to the union; define `startBinding`/`endBinding` shape.
2. Implement `shape-border-intersection.ts`: rectangle (trivial edge clip), ellipse (parametric intersection), diamond (edge-segment intersection) — three focused pure functions, unit tested against known geometric cases.
3. Implement `recompute-binding.ts`: given a moved/resized element and its bound arrows, compute new endpoint(s) using the border-intersection functions + stored `focus`/`gap`.
4. Wire the `Scene.updateElement` hook: after mutating an element, if it has `boundElements`, call `recompute-binding` for each and apply the resulting arrow updates (as part of the same history batch — one drag = one undo step, per phase 02's design).
5. Implement `arrow-tool.ts`: drag/multi-point creation, endpoint-drag binding detection (proximity threshold to a shape's border), `startBinding`/`endBinding` assignment + reciprocal `boundElements` update on the target shape.
6. Implement `arrow-renderer.ts`: straight/curved path rendering (rough.js for the sketchy stroke, consistent with phase 05), arrowhead geometry for all 5 styles × 2 ends. Elbow routing as a distinct code path, explicitly flagged as the phase's stretch item per Key Insights.
7. Wire bound labels via phase 07's `bound-text.ts` (arrow acts as a "container" for label positioning purposes — same auto-recenter-on-change pattern).
8. Unit tests: border intersection correctness per shape type; reroute correctness (move a bound rectangle, assert arrow endpoint follows); arrowhead-direction-from-config correctness (mirrors `extract-canvas-diagram.ts`'s `isArrowhead`/direction logic so phase 15's extraction stays consistent).

## Todo List
- [ ] `ArrowElement` + binding model implemented
- [ ] Border-intersection math correct for rect/ellipse/diamond (unit tested)
- [ ] Binding-on-create (endpoint-drag proximity to shape) working
- [ ] Reroute-on-move/resize working and undo-batched correctly
- [ ] Straight + curved arrows rendering with all 5 arrowhead styles × 2 ends
- [ ] Bound labels working (create, edit, recenter on reroute)
- [ ] Elbow arrows implemented OR explicitly deferred with a tracked follow-up (not silently dropped)

## Success Criteria
- Dev harness: draw two rectangles, connect with an arrow bound at both ends, drag one rectangle — arrow follows and stays clipped at the border, not overlapping.
- Unit tests green for border intersection, reroute, arrowhead direction.
- Undo after a bound-shape move restores both the shape position and the arrow endpoint in one step.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Elbow (orthogonal) routing algorithm underestimated, blows the phase timeline | High (explicitly flagged by research as hardest subsystem) | Medium | Straight/curved + binding + labels ships as the phase's definition of done; elbow routing is called out as separable and can land as a fast-follow without blocking phase 09+ |
| Reroute recompute triggers infinite update loops (arrow bound to two shapes that are also bound to each other via other arrows) | Low | High (freeze/crash) | `recompute-binding` is a pure, non-recursive function operating only on the arrow's own two endpoints — no transitive shape-to-shape propagation exists in this model, so cycles can't form; add a regression test with a shape that has 2 bound arrows both ends to confirm no double-recompute bug |
| Border-intersection math wrong for rotated shapes | Medium | Medium | Explicitly unit test rotated-rectangle/ellipse cases, not just axis-aligned |

## Security Considerations
- None beyond phase 07's text-label escaping (reused, not reimplemented).

## Next Steps
- Blocks: 10 (selection/move of bound shapes exercises reroute path), 15 (scene-read API's edge extraction depends on this binding model matching `CanvasArrowBindingInput`'s shape).
- Rollback: additive — revert commit; if elbow routing ships partially and causes render bugs, disabling the elbow `arrowType` option (falling back to straight) is a safe partial rollback without touching binding data.
