---
title: "Deviva Draw — Infinite Canvas Whiteboard, Built From Scratch"
description: "Clean-room Excalidraw-class whiteboard: engine + React lib + collab, replacing tldraw in deviva.app"
status: in-progress
priority: P1
effort: 12-18mo (solo)
branch: main
tags: [canvas, whiteboard, monorepo, collab, cloudflare]
created: 2026-08-08
---

# Deviva Draw — Implementation Plan

**Locked decisions** (do not revisit): zero Excalidraw code; small MIT single-purpose libs OK (rough.js, perfect-freehand, fractional-indexing); V1 = full parity incl. live collab; solo whiteboard must be dogfoodable early; two deliverables — standalone app (draw.deviva.app) + React lib replacing tldraw in `deviva/apps/web/components/design-canvas.tsx`.

**Context:** `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` (feature inventory/scope contract), `plans/reports/research-260808-excalidraw-drawing-tool-for-deviva.md` (why), `deviva/apps/web/components/{design-canvas.tsx,read-tldraw-diagram.ts,extract-canvas-diagram.ts}` (integration contract the lib must satisfy — `CanvasShapeInput`/`CanvasArrowBindingInput` shape).

## Monorepo Split

```
deviva-draw/
├── packages/engine/          framework-agnostic core: element model, scene store, history,
│                              renderer, geometry, input/tools FSM, bindings, serializers
├── packages/react/           @deviva-draw/react — <DevivaDraw/>, hooks, UI chrome, scene-read API
├── packages/collab-client/   WS sync client, E2E crypto, presence, conflict resolution
├── apps/web/                 standalone app (draw.deviva.app) — Vite SPA, not Next.js (see phase 01)
└── apps/collab-server/       Cloudflare Worker: Durable Objects room + R2 share-link blobs
```

## Milestones

| Milestone | Phases | Outcome |
|---|---|---|
| M1 Solo MVP (dogfood) | 01–11 | Functional single-user whiteboard: shapes, freehand, text, arrows, images, select/transform, save/export |
| M2 Parity | 12–13 | Full UI chrome, shortcuts, mobile, theming, i18n, encrypted share links |
| M3 Collab | 14 | Live multiplayer via Durable Objects |
| M4 Product | 15–16 | Lib replaces tldraw in deviva.app; marketing site ships |

## Phases

| # | Phase | Depends on | Status |
|---|---|---|---|
| 01 | [Monorepo scaffold & tooling](phase-01-monorepo-scaffold-and-tooling.md) | — | ✅ done (2026-08-08) |
| 02 | [Core element model, scene store & history](phase-02-core-element-model-scene-store-history.md) | 01 | ✅ done (2026-08-08, 67 tests) |
| 03 | [Canvas renderer: dual-layer, viewport, culling](phase-03-canvas-renderer-dual-layer-viewport.md) | 02 | ✅ done (2026-08-08, 107 engine tests) |
| 04 | [Input pipeline & tools state machine](phase-04-input-pipeline-and-tools-state-machine.md) | 02, 03 | ✅ done (2026-08-08, 190 engine tests) |
| 05 | [Shape tools & style system](phase-05-shape-tools-and-style-system.md) | 03, 04 | ✅ done (2026-08-08, 288 engine tests) |
| 06 | [Freehand drawing tool](phase-06-freehand-drawing-tool.md) | 03, 04 | ✅ done (2026-08-08, 339 engine tests) |
| 07 | [Text editing & bound containers](phase-07-text-editing-and-bound-containers.md) | 04, 05 | ✅ done (2026-08-08, 431 engine + 5 react tests) |
| 08 | [Arrows & element bindings](phase-08-arrows-and-element-bindings.md) | 05, 07 | ✅ done (2026-08-08, 572 engine tests) |
| 09 | [Image elements](phase-09-image-elements.md) | 02, 03, 04 | ✅ done (2026-08-08, 639 engine + 22 react tests) |
| 10 | [Selection, transforms, snapping & grid](phase-10-selection-transforms-snapping-grid.md) | 05, 06, 07, 08, 09 | ✅ done (2026-08-08, 835 engine tests) |
| 11 | [Persistence & export](phase-11-persistence-and-export.md) | 10 | ✅ done (2026-08-09, 991 engine tests) — M1 complete |
| 12 | [UI chrome, shortcuts, mobile, theming & i18n](phase-12-ui-chrome-shortcuts-mobile-theming-i18n.md) | 10, 11 | ✅ done (2026-08-09, 1005 engine + 137 react + 10 e2e) |
| 13 | [Share links (E2E encrypted, R2)](phase-13-share-links-e2e-encryption.md) | 11 | ✅ done (2026-08-09, 30 worker tests, key-leak proven absent) |
| 14 | [Collab server (Durable Objects) & client sync](phase-14-collab-server-and-client-sync.md) | 02, 11, 13 | ✅ done (2026-08-09, 111 collab-client + 71 worker tests) — M3 complete |
| 15 | [React lib extraction & deviva.app integration](phase-15-react-lib-package-and-deviva-integration.md) | 05, 06, 07, 08, 09, 10, 11, 12 | ✅ done (2026-08-09) — deviva-side swap staged for review; npm publish pending |
| 16 | [Marketing site & deployment](phase-16-marketing-site-and-deployment.md) | 12, 13, 15 (soft: 14) | pending |

## Cross-Cutting Rules

- Every element mutation bumps `version`/`versionNonce` and reassigns fractional `index` when reordered (phase 02 foundation) — never retrofit, collab depends on this from day one.
- Files < 200 lines, kebab-case, self-contained comments (no phase refs in code).
- Test strategy: Vitest unit for `packages/engine` (pure logic, no DOM canvas needed for geometry/history/serializers) and `packages/react` hooks; Playwright e2e for `apps/web` (pointer-driven scene assertions, not pixel diffs, except seeded rough.js golden tests).
- Each phase ships independently reviewable + testable; no phase merges to main with failing tests.

## Unresolved Questions
1. Hand-drawn font: need to commission/license a Deviva-owned font (Excalifont is OFL, not verified for redistribution under new brand) — blocks phase 07 font asset, flagged there.
2. `apps/collab-server` deploy domain (e.g. `collab.draw.deviva.app`) and whether it shares the Cloudflare account/zone with `deviva.app` — needed before phase 14 DNS setup, confirm with user.
3. Whether `packages/react` should also expose a Vue/vanilla adapter later (out of scope for V1, noted for future).
