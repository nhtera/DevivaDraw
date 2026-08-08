# Project Roadmap

Source of truth for phase-level detail: `plans/260808-1624-deviva-draw-whiteboard-from-scratch/plan.md`
and its per-phase files in the same directory. This doc summarizes status;
update it when a milestone (not individual phase) completes or scope shifts.

**Locked decisions** (per plan.md, do not revisit without explicit user
sign-off): zero Excalidraw code (clean-room); small single-purpose MIT libs
OK (roughjs, perfect-freehand, fractional-indexing); V1 scope = full parity
including live collab; solo whiteboard must be dogfoodable early; two
deliverables — standalone app (`draw.deviva.app`) + React lib replacing
tldraw in `deviva/apps/web/components/design-canvas.tsx`.

## Milestones

| Milestone | Phases | Status | Outcome |
|---|---|---|---|
| **M1 Solo MVP (dogfood)** | 01-11 | ✅ **complete** (2026-08-09) | Functional single-user whiteboard: shapes, freehand, text, arrows, images, select/transform, save/export |
| M2 Parity | 12-13 | pending | Full UI chrome, shortcuts, mobile, theming, i18n, encrypted share links |
| M3 Collab | 14 | pending | Live multiplayer via Cloudflare Durable Objects |
| M4 Product | 15-16 | pending | React lib replaces tldraw in deviva.app; marketing site ships |

## M1 phases (all done)

| # | Phase | Result |
|---|---|---|
| 01 | Monorepo scaffold & tooling | pnpm workspace, engine/react/collab-client packages, web/collab-server apps |
| 02 | Core element model, scene store & history | frozen elements, `touch()` version/versionNonce invariant, fractional z-index, `HistoryStack` — 67 tests |
| 03 | Canvas renderer: dual-layer, viewport, culling | `Camera`, viewport culling, `StaticLayer`/`InteractiveLayer` — 107 engine tests |
| 04 | Input pipeline & tools state machine | `PointerEventPipeline`, `ToolStateMachine`, `ToolHandler` contract — 190 engine tests |
| 05 | Shape tools & style system | rectangle/ellipse/diamond/line via rough.js, `ShapeStyleState` — 288 engine tests |
| 06 | Freehand drawing tool | perfect-freehand integration, pressure-sensitive strokes — 339 engine tests |
| 07 | Text editing & bound containers | WYSIWYG overlay, bound-text layout/sync — 431 engine + 5 react tests |
| 08 | Arrows & element bindings | bidirectional shape↔arrow bindings, endpoint recompute, reroute-on-move — 572 engine tests |
| 09 | Image elements | content-addressed `FilesMap`, `ImageDecodeCache`, insert/resize — 639 engine + 22 react tests |
| 10 | Selection, transforms, snapping & grid | marquee, resize/rotate handles, align/distribute, group/ungroup, grid+object snapping — 835 engine tests |
| 11 | Persistence & export | `SceneDocumentV1` schema + migrations, autosave, PNG (embedded scene data)/SVG export — 991 engine tests — **M1 complete** |

## M2-M4 phases (pending, unstarted)

| # | Phase | Depends on |
|---|---|---|
| 12 | UI chrome, shortcuts, mobile, theming & i18n | 10, 11 |
| 13 | Share links (E2E encrypted, R2) | 11 |
| 14 | Collab server (Durable Objects) & client sync | 02, 11, 13 |
| 15 | React lib extraction & deviva.app integration | 05-12 |
| 16 | Marketing site & deployment | 12, 13, 15 (soft: 14) |

## Cross-cutting rules (apply to every future phase)

- Every element mutation bumps `version`/`versionNonce` via `touch()` — collab (phase 14) depends on this having been true since phase 02, never retrofitted.
- Files under ~200 lines, kebab-case, self-contained comments (no phase refs in code) — see [Code Standards](./code-standards.md).
- Engine/react: Vitest unit tests, DOM-free where possible via injectable abstractions. `apps/web`: Playwright e2e (pointer-driven scene assertions, not pixel diffs — except seeded rough.js golden tests).
- No phase merges with failing tests.

## Unresolved questions (carried from plan.md)

1. Hand-drawn font: needs a Deviva-owned font commissioned/licensed (Excalifont is OFL, redistribution under new brand not verified) — blocks a phase 07 font-asset follow-up.
2. `apps/collab-server` deploy domain (e.g. `collab.draw.deviva.app`) and whether it shares the Cloudflare account/zone with `deviva.app` — needed before phase 14 DNS setup.
3. Whether `packages/react` should also expose a Vue/vanilla adapter later — out of scope for V1, noted for future.

## See also

- [Codebase Summary](./codebase-summary.md)
- [System Architecture](./system-architecture.md)
- Full phase specs: `plans/260808-1624-deviva-draw-whiteboard-from-scratch/`
