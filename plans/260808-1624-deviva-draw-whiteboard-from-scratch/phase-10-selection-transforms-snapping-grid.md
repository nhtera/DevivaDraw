# Phase 10 — Selection, Transforms, Snapping & Grid

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §1 (grid/snap), §3 (Element Manipulation)
- Depends on: `phase-05-shape-tools-and-style-system.md`, `phase-06-freehand-drawing-tool.md`, `phase-07-text-editing-and-bound-containers.md`, `phase-08-arrows-and-element-bindings.md`, `phase-09-image-elements.md` (needs every element type to exist so selection/transform is implemented generically against the full union, not shape-by-shape)

## Overview
- **Priority:** 🔴 blocking for MVP — "solo whiteboard" isn't usable without select/move/resize/delete
- **Status:** pending
- Replace phase 04's selection-tool skeleton with full selection (click, shift-click, rubber-band, select-all, deep-select-in-group), multi-select transforms (move/resize/rotate/flip as one unit), group/ungroup, z-order operations, align/distribute, duplicate/copy/paste/delete, lock/unlock, and grid+snapping.

## Key Insights
- This is the single largest phase by scope (mirrors §3's long checklist) — split implementation into three internal milestones within the phase: (a) single-element select+move+resize+rotate, (b) multi-select as one unit + group/ungroup + z-order + align/distribute, (c) grid/snapping + duplicate/clipboard + lock. Each is independently testable; don't treat this as one monolithic PR.
- Resize handles (8 handles: 4 corners + 4 edges) need per-element-type resize semantics: rect/ellipse/diamond scale bounds directly; freedraw scales its point array proportionally (flagged as a dependency back onto phase 06); text/bound-text re-triggers phase 07's wrap-and-measure at the new width; arrows with bound endpoints trigger phase 08's `recomputeBinding`. This phase's resize implementation is a dispatcher that calls into each of those existing per-type hooks rather than reimplementing per-type logic here — the type-specific logic already lives where it was built.
- Multi-select transform-as-one-unit: compute one bounding box for the selection, apply move/resize/rotate as a transform on that bbox, then map each element's own transform proportionally — this is standard "group transform" math (translate to origin, scale/rotate, translate back), unit-testable in isolation from any specific element type.
- Snapping: object-to-object alignment guides (edges/centers of nearby elements) plus grid snap (when grid mode on) — both compute "candidate snap lines" near the dragged element's current position and adjust the drop position to the nearest within a pixel threshold; rendered as temporary guide lines on the interactive layer (phase 03) during drag only.
- Clipboard: internal copy/paste (Deviva Draw's own element JSON on the clipboard, `application/x-deviva-draw+json` custom MIME alongside a plain-text/image fallback) plus system clipboard image paste (already handled in phase 09) — internal paste offsets pasted elements slightly so they're visibly distinct from the originals, not stacked exactly on top.

## Requirements
- Selection: click (single), shift-click (add/remove), rubber-band drag-select, `Ctrl/Cmd+A` select-all, double-click into a group for deep-select.
- Transform: move (mouse + arrow keys, shift = axis lock), resize (8 handles, shift = aspect lock, alt = from-center), rotate handle (shift = 15° steps), flip H/V.
- Multi-select: all transforms apply to the group as one unit; internal per-element updates still individually version-bumped (phase 02) for collab correctness.
- Group/ungroup (nested groups supported via `groupIds` array already on base element from phase 02).
- Z-order: bring/send forward/backward/to-front/to-back (uses phase 02's fractional index helpers).
- Align (6 ways: left/center/right/top/middle/bottom) + distribute H/V.
- Duplicate (alt-drag, Ctrl/Cmd+D), copy/cut/paste (internal + system clipboard image), delete.
- Lock/unlock (locked elements ignore pointer selection); link URL attach (stores a `link` field, already in base element).
- Grid mode + snap-to-grid; object snapping with alignment guides.

## Architecture
```
packages/engine/src/selection/
├── selection-state.ts        selected element ids, deep-select group context
├── selection-tool.ts          full ToolHandler (replaces phase 04's skeleton)
├── group-transform.ts         bbox-based multi-select move/resize/rotate math
├── resize-dispatch.ts          per-element-type resize hook dispatcher
├── group-ungroup.ts
├── align-distribute.ts
├── z-order-ops.ts               wraps phase 02's fractional index helpers
├── clipboard.ts                 internal + system clipboard
└── snapping.ts                   grid snap + object alignment guides
```

## Related Code Files
- Modify: `packages/engine/src/input/selection-tool-skeleton.ts` → replaced by `packages/engine/src/selection/selection-tool.ts` (delete skeleton)
- Create: all files listed in Architecture, each with `.test.ts`
- Modify: `packages/engine/src/render/interactive-layer.ts` (render selection outline, resize/rotate handles, snap guides, rubber-band rect)
- Modify: `packages/engine/src/tools/shape-style-state.ts` (implement the `applyToSelection` branch stubbed in phase 05)

## Implementation Steps
1. **Milestone A — single select/transform:** selection state, click hit-testing (reuse phase 04's coordinate pipeline), single-element move (pointer + arrow keys), resize-dispatch for each existing element type, rotate handle.
2. **Milestone B — multi-select + structure:** rubber-band select, shift-click, group-transform math, group/ungroup, z-order ops, align/distribute, `applyToSelection` style application.
3. **Milestone C — polish:** grid rendering + snap-to-grid, object alignment guides, duplicate/clipboard (internal MIME + system image fallback), lock/unlock, delete (soft-delete via phase 02's `isDeleted`).
4. Interactive layer gets real content for the first time: selection outline, 8 resize handles + rotate handle, rubber-band rectangle, snap guide lines — all transient, never touch `Scene`/history until a gesture commits.
5. Unit tests per milestone: group-transform math (known bbox + known transform → expected per-element output), resize-dispatch calls the correct per-type hook (mock each), z-order fractional-index correctness, align/distribute pixel math, snap-threshold correctness.
6. Manual QA pass: full checklist from §3 of the feature inventory, checked off item by item (not just "it compiles").

## Todo List
- [ ] Milestone A: single select/move/resize/rotate working
- [ ] Milestone B: multi-select transform-as-unit, group/ungroup, z-order, align/distribute working
- [ ] Milestone C: grid/snap, duplicate/clipboard, lock/unlock, delete working
- [ ] Resize dispatch correctly delegates to freedraw/text/arrow-binding hooks (regression tested against phases 06/07/08)
- [ ] Interactive layer renders selection/handles/guides without touching persisted scene state
- [ ] Full §3 checklist manually verified against a reference (excalidraw.com) for feel-parity

## Success Criteria
- Dev harness: draw 5 mixed-type elements, multi-select, move/resize/rotate as one unit, ungroup preserves individual positions correctly.
- Undo/redo correct at every granularity (single move = one step, multi-select move = one step).
- Unit tests green across all selection/transform modules.
- **M1 Solo MVP milestone reached**: with phases 01–10 complete, a user can draw, select, arrange, and organize a diagram entirely solo (persistence/export still pending phase 11, but the app is now internally demo-able).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Resize-dispatch misses an edge case for one element type (e.g. resizing a container with bound text near its minimum size) | Medium | Medium | Explicit per-type unit tests in this phase, not just the generic dispatcher test |
| Snapping performance degrades with many elements (checking every element as a snap candidate on every drag frame) | Medium | Low | Reuse phase 03's viewport culling to limit snap-candidate search to visible elements only |
| Group transform math drifts for rotated child elements inside a rotated group (compound rotation) | Medium | Medium | Dedicated unit test with a pre-rotated child inside a group that itself gets rotated — known failure mode in clone implementations per research report |

## Security Considerations
- Clipboard read (system paste) already covered by phase 09's paste handler security notes; internal clipboard MIME is same-origin JSON, no additional risk.

## Next Steps
- Blocks: 11 (export needs "selection-only" export scope), 12 (UI chrome wires buttons to these operations), 14 (collab must handle concurrent transforms — this phase's per-element version-bump discipline is what makes that tractable later).
- Rollback: additive but touches phase 04's tool skeleton (delete) — revert as one commit since skeleton removal and full selection landing are coupled.
