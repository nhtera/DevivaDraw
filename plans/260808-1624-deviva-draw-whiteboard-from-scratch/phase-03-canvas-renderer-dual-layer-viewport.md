# Phase 03 — Canvas Renderer: Dual-Layer, Viewport, Culling

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §1 (Canvas Engine)
- `plans/reports/research-260808-excalidraw-drawing-tool-for-deviva.md` (rendering architecture reference link: deepwiki excalidraw 6.1)
- Depends on: `phase-02-core-element-model-scene-store-history.md`

## Overview
- **Priority:** 🔴 blocking — tools (phase 04+) need something to draw into
- **Status:** pending
- Build the Canvas2D rendering pipeline: camera/viewport model, dual-layer (static cache + interactive overlay) compositing, devicePixelRatio handling, and viewport culling. No shape-specific drawing yet (that's phase 05+) — this phase renders a generic placeholder box per element to prove the pipeline.

## Key Insights
- **Dual-canvas rationale (user asked to justify or propose better — justifying as-is):** a static `<canvas>` caches the rendered scene (redrawn only when elements change), a second interactive `<canvas>` on top redraws every frame/pointer-move for selection outlines, resize handles, and remote cursors. Without this split, every pointer-move during a drag would force a full re-render of potentially thousands of rough.js-sketchy elements at 60fps — measured as the dominant cost in Excalidraw's own architecture (per research link). No simpler alternative meets both "redraw cheaply on pan" and "sketchy rendering is expensive" simultaneously; WebGL was considered and rejected — rough.js/perfect-freehand output is CPU-side path data, not GPU-friendly primitives, and a from-scratch WebGL renderer is a multi-month side-project on top of an already 12mo+ scope (YAGNI).
- Camera model: `{scrollX, scrollY, zoom}` in scene space; all pointer coordinates converted scene↔screen through one pair of pure functions (`sceneToScreen`, `screenToScene`) — every later phase (input, selection, export) reuses these, so get them exactly right and unit-tested here.
- devicePixelRatio: canvas backing store sized `cssWidth * dpr`, context scaled by `dpr`, CSS size stays `cssWidth` — standard retina pattern, must be re-applied on window resize and on zoom-level canvas resize.
- Viewport culling: skip elements whose bounding box doesn't intersect the visible scene rect before handing them to the (future) shape-drawing dispatch — implemented as a pure filter function, unit-testable without a real canvas.
- Static layer redraw triggers: scene `version` change (any element added/updated/deleted) or camera change (pan/zoom moves what's visible, cache must be redrawn... note: panning does NOT require redrawing element paths, only re-blitting at a new offset — for V1 simplicity, redraw the static layer on both scene changes and camera changes; a pan-without-redraw optimization via canvas `translate` is a documented future optimization, not blocking MVP, flagged so it isn't forgotten).

## Requirements
- `Camera` type + `sceneToScreen`/`screenToScene` pure functions, unit tested.
- `StaticLayer`: owns one `<canvas>`, exposes `render(scene, camera)`, internally diffs "did version or camera change" to skip redundant redraws.
- `InteractiveLayer`: owns a second `<canvas>`, same size/position, exposes `render(overlayState, camera)` (overlay state is empty this phase — populated by selection in phase 10).
- `CanvasStage` component (framework-agnostic controller, not React yet): owns both canvases, handles resize/DPR, exposes `mount(container)`/`unmount()`.
- Viewport culling function: `getVisibleElements(scene, camera, viewportSize)`.
- Placeholder shape renderer: draws a plain stroked rect for every element's bounding box (proves the pipeline; replaced/extended per-type starting phase 05).

## Architecture
```
packages/engine/src/render/
├── camera.ts              Camera type, sceneToScreen/screenToScene
├── canvas-stage.ts         owns 2 <canvas> elements, resize/DPR handling
├── static-layer.ts         cached scene render
├── interactive-layer.ts    overlay render (selection/cursors — populated later)
├── viewport-culling.ts     getVisibleElements
└── draw-element-placeholder.ts   temporary generic box renderer
```
Data flow: `Scene` (phase 02) → `getVisibleElements(scene, camera)` → `StaticLayer.render()` iterates culled elements → placeholder draw fn → blit. `InteractiveLayer` renders on top every animation frame while a gesture is active (wired properly in phase 04/10).

## Related Code Files
- Create: `packages/engine/src/render/camera.ts`, `camera.test.ts`
- Create: `packages/engine/src/render/canvas-stage.ts`
- Create: `packages/engine/src/render/static-layer.ts`
- Create: `packages/engine/src/render/interactive-layer.ts`
- Create: `packages/engine/src/render/viewport-culling.ts`, `viewport-culling.test.ts`
- Create: `packages/engine/src/render/draw-element-placeholder.ts`
- Create (integration proof): `apps/web/src/dev-canvas-harness.tsx` (temporary manual test page, wires CanvasStage into the Vite app to visually confirm pan/zoom/culling before phase 04 tools exist)

## Implementation Steps
1. `camera.ts`: define `Camera`, implement `sceneToScreen(point, camera)`/`screenToScene(point, camera)` as pure functions; unit test round-trip identity and a known zoom/pan transform.
2. `viewport-culling.ts`: implement AABB-intersection filter; unit test with elements fully inside/outside/straddling viewport.
3. `canvas-stage.ts`: create two absolutely-positioned canvases in a container div, implement DPR-aware resize (`ResizeObserver` on container).
4. `static-layer.ts`: render loop that early-returns if neither scene version nor camera changed since last render; draws placeholder boxes for culled-in elements.
5. `interactive-layer.ts`: empty render loop scaffold (clears + no-ops this phase, real content in phase 10).
6. Wire a temporary dev harness page in `apps/web` (mouse-wheel zoom, drag-to-pan against `Scene` seeded with a handful of fake elements) to visually verify — this harness is deleted/replaced once phase 04's real tool system exists.
7. Manual test: zoom to 3000%/10% (spec range from feature inventory), confirm placeholder boxes still align pixel-correct with a known scene coordinate.

## Todo List
- [ ] Camera + coordinate transforms implemented, unit tested (round-trip + known-value cases)
- [ ] Viewport culling implemented, unit tested
- [ ] CanvasStage handles resize + DPR correctly (visually verified at 1x and 2x DPR)
- [ ] Static layer redraws only on version/camera change (verified via render-call counter in test)
- [ ] Interactive layer scaffold in place (no-op render loop)
- [ ] Dev harness in apps/web demonstrates pan/zoom/culling working end-to-end

## Success Criteria
- Unit tests green for camera + culling (pure functions, no canvas needed).
- Manual/visual: dev harness pans and zooms smoothly (no visible lag) with 500+ placeholder elements, off-screen elements confirmed not drawn (via a debug counter overlay).
- Zoom range 10%–3000% functions without coordinate drift (round-trip test covers this numerically; harness confirms visually).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Coordinate transform bugs surface far downstream (e.g., selection hit-testing in phase 10 is off by DPR factor) | Medium | High | Lock `sceneToScreen`/`screenToScene` with round-trip unit tests now; every later phase reuses these two functions exclusively, never reimplements coordinate math |
| Static-layer redraw-skip logic has a stale-cache bug (misses a change) | Medium | Medium | Version-number comparison (not deep-equality) — cheap, correct as long as phase 02's version bump is centralized (it is, per phase 02) |
| Performance regresses once real rough.js drawing replaces placeholder boxes | Medium | Medium | Flagged now as a watch-item for phase 05; culling + static caching already in place to absorb the added per-element cost |

## Security Considerations
- None (no user input parsing yet, pure rendering of trusted in-memory data).

## Next Steps
- Blocks: 04 (input needs `screenToScene` for pointer coords), all shape-drawing phases (05, 06, 07, 08, 09 extend `draw-element-placeholder.ts`'s dispatch pattern per type), 10 (interactive layer gets real content).
- Rollback: renderer is additive/internal, no external state — revert commit.
