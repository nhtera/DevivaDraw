# Phase 02 — Core Element Model, Scene Store & History

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §8 (History & State), §10 (Collaboration — versioning is a collab prerequisite, must not be retrofitted)
- `deviva/apps/web/components/extract-canvas-diagram.ts` (target read-shape: `CanvasShapeInput`/props the eventual scene-read API must be able to produce)
- Overview: `plan.md`

## Overview
- **Priority:** 🔴 blocking — every tool/renderer/collab phase depends on this schema
- **Status:** ✅ done (2026-08-08) — 67 unit tests; review fixes applied (frozen elements, queued notify, cancelBatch, duplicate-id throw)
- Define the element data model, the in-memory scene store (CRUD + subscriptions), and the undo/redo history stack. This is the single source of truth every other package reads/writes.

## Key Insights
- Collab (phase 14) cannot be bolted on later without a rewrite — `version`, `versionNonce`, and fractional `index` must exist on every element from the first commit, even though nothing consumes them until phase 14. This is a locked user decision, not optional scope.
- Fractional indexing: use the small MIT single-purpose lib `fractional-indexing` (rocicorp) rather than hand-rolling base62 midpoint math — fits the user's "small MIT utility libs allowed" carve-out, avoids a subtle-bug-prone reimplementation. If unavailable/unmaintained at scaffold time, fall back to a ~40-line in-house implementation (documented algorithm: base62 midpoint string generation).
- Scene store must be framework-agnostic (no React) — `packages/react` wraps it in hooks in phase 05+, but the store itself lives in `packages/engine` so `apps/collab-server` reasoning about the same element shape (for LWW merge) never imports React.
- History: Excalidraw-style "one user gesture = one undo step" — the store batches mutations between `beginTransaction()`/`commit()` calls (or a debounced flush) rather than snapshotting on every single field write, or every pixel of a drag becomes its own undo step.
- `isDeleted` tombstone flag (not hard delete) is required for collab merge correctness later (phase 14) and for undo of deletes — decide this now, don't retrofit.

## Requirements
- Element base type (all shape/text/arrow/image/freedraw elements extend this): `id, type, x, y, width, height, angle, strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, roundness, seed, groupIds, frameId, boundElements, link, locked, index (fractional string), version, versionNonce, updated (timestamp), isDeleted`.
- `Scene` class: `getElements()`, `getElement(id)`, `addElement`, `updateElement(id, partial)`, `deleteElement(id)` (soft), `subscribe(listener)`.
- Every mutating method bumps `version += 1` and regenerates `versionNonce` (random int) — non-negotiable, unit-tested.
- `HistoryStack`: `push(snapshot)`, `undo()`, `redo()`, `beginBatch()/endBatch()` for gesture grouping; caps stack depth (configurable, default matches Excalidraw's ~100).
- JSON-serializable at every step (no class instances/functions on elements) — required for phase 11 persistence and phase 14 wire format.

## Architecture
- `packages/engine/src/elements/` — type definitions + factory functions (`createRectangleElement(...)` etc., stubbed for shapes not yet built — only base + a generic element are needed this phase; concrete shape types added incrementally in phases 05–09 as thin extensions of the base).
- `packages/engine/src/scene/scene.ts` — the store (< 200 lines; split into `scene.ts` + `scene-mutations.ts` if it grows).
- `packages/engine/src/scene/fractional-index.ts` — wraps `fractional-indexing` lib, exposes `indexBetween(a, b)`.
- `packages/engine/src/history/history-stack.ts`.
- Data flow: tool/UI calls `scene.updateElement()` → scene bumps version/versionNonce/index → notifies subscribers → renderer (phase 03) redraws → history records the pre/post diff for undo.

## Related Code Files
- Create: `packages/engine/src/elements/base-element.ts`, `packages/engine/src/elements/element-types.ts`
- Create: `packages/engine/src/scene/scene.ts`, `packages/engine/src/scene/fractional-index.ts`
- Create: `packages/engine/src/history/history-stack.ts`
- Create: `packages/engine/src/scene/scene.test.ts`, `packages/engine/src/history/history-stack.test.ts`

## Implementation Steps
1. Define `ExcalidrawLikeElement` base interface + `AnyElement` discriminated union (starts with just a generic `type: string` placeholder; concrete union members added per phase).
2. Implement `Scene` class with subscription (simple pub-sub, no external state lib — YAGNI, don't pull in Redux/Zustand for engine internals).
3. Implement version/versionNonce/index bump logic centrally (one internal `touch(element)` helper every mutation path calls — prevents drift where one code path forgets to bump).
4. Add `fractional-indexing` dependency; implement `indexBetween` wrapper + z-order helpers (`moveToFront`, `moveToBack`, `moveForward`, `moveBackward` — used later by phase 10, stub now, test now).
5. Implement `HistoryStack` with batch grouping; write unit tests simulating a "drag gesture" as one batch.
6. Write unit tests: version bumps on every mutation, undo/redo restores exact prior state, fractional index ordering stays stable under repeated inserts (regression test for the "index converges to same length" class of bug fractional-indexing implementations are prone to).

## Todo List
- [ ] Base element type + union defined
- [ ] `Scene` CRUD + subscribe implemented and unit tested
- [ ] Every mutation bumps version/versionNonce (test asserts this explicitly, not just implicitly)
- [ ] Fractional index helper implemented + z-order helpers stubbed
- [ ] `HistoryStack` undo/redo + batching implemented and unit tested
- [ ] `isDeleted` soft-delete + purge-on-export semantics documented in code comment

## Success Criteria
- `pnpm --filter @deviva-draw/engine test` green, coverage on scene/history modules.
- Manual: a scripted sequence (add 3 elements, undo twice, redo once) produces the exact expected scene snapshot in a test.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Version/nonce bump forgotten on a future mutation path (new phase adds a shortcut mutation) | Medium | High (silently breaks collab merge in phase 14) | Centralize all mutation through one `touch()` path now; lint rule or code review checklist item added to phase 14 |
| Fractional index string growth unbounded under pathological insert patterns | Low | Medium | Rely on well-tested `fractional-indexing` lib; add regression test with 1000 sequential same-position inserts |
| History batching groups wrong things (e.g., merges two unrelated edits) | Medium | Medium | Explicit `beginBatch/endBatch` API called by input layer (phase 04) at gesture start/end, not implicit timers |

## Security Considerations
- None at this phase (pure in-memory data structures, no network/storage yet).

## Next Steps
- Blocks: 03 (renderer reads Scene), 04 (input mutates Scene), all shape/tool phases, 11 (serialization), 14 (collab wire format reuses this exact schema).
- Rollback: this package has no external consumers yet outside the monorepo — revert commit, no migration needed.
