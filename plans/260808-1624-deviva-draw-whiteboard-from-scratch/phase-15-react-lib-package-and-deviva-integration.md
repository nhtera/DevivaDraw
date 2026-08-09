# Phase 15 — React Lib Package Extraction & deviva.app Integration

## Context Links
- `deviva/apps/web/components/design-canvas.tsx`, `read-tldraw-diagram.ts`, `extract-canvas-diagram.ts` (the exact integration surface being replaced — `CanvasShapeInput { id, type, parentId, props: {geo, name, text, richText, arrowheadStart, arrowheadEnd} }`, `CanvasArrowBindingInput { fromId, toId, terminal }`)
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §13 (`packages/draw-core` lib export deliverable)
- Depends on: `phase-05` (shapes), `phase-06` (freehand), `phase-07` (text/`getLabel`), `phase-08` (arrows/bindings), `phase-09` (images), `phase-10` (selection), `phase-11` (persistence), `phase-12` (UI chrome — the lib should offer a UI-configurable variant, not just raw canvas)

## Overview
- **Priority:** 🔴 (deliverable b — the reason a "reusable React lib" was a stated requirement, not just a nice-to-have)
- **Status:** pending
- Harden `packages/react` into a publishable, documented package (`@deviva-draw/react`), add a scene-read API for diagram extraction matching the contract `extract-canvas-diagram.ts` already expects, then swap it into `deviva/apps/web/components/design-canvas.tsx` in place of tldraw, deleting the tldraw dependency.

## Key Insights
- **The integration contract already exists and is decoupled from any specific drawing library** — `extract-canvas-diagram.ts`'s `extractDiagram(shapes, bindings)` takes `CanvasShapeInput[]`/`CanvasArrowBindingInput[]`, not tldraw types. This phase's job is narrower than it sounds: write one adapter file (`read-deviva-draw-diagram.ts`, mirroring `read-tldraw-diagram.ts`'s role) that maps Deviva Draw's own element model to that same input shape, and `extractDiagram` itself needs zero changes.
- Field mapping (verified against `extract-canvas-diagram.ts:30-66` and this plan's phases):
  - `shape.type` — Deviva Draw element `.type` maps directly for `text`; rect/ellipse/diamond map to a `geo`-carrying shape (`NODE_TYPES` expects `"geo"` type with a `props.geo` sub-kind of `rectangle|ellipse|diamond`, per `GEO_KINDS` in `extract-canvas-diagram.ts:56-66`) — the adapter must translate Deviva Draw's flat `type: "rectangle"` into `{type: "geo", props: {geo: "rectangle"}}` shape, not assume identical naming. This is exactly the kind of adapter-layer mismatch the existing code was deliberately built to absorb (per its own doc comment: "a tldraw upgrade can only break the one adapter").
  - `parentId` — Deviva Draw's `groupIds[last]` (nearest enclosing group, phase 10) or containing frame maps to `parentId`; Deviva Draw doesn't have tldraw's frame concept 1:1 — decide whether "frame" parity (feature inventory §1, marked 🟡) is needed for this mapping or whether `groupIds` alone suffices for V1 diagram extraction (recommend: `groupIds` suffices, frames are a visual/export concept not required for the interview diagram-reading use case — confirm with user if uncertain, don't silently assume).
  - `props.text`/`props.richText` — phase 07's `getLabel(element)` utility already returns the plain-text label uniformly; the adapter can populate `props.text` directly from `getLabel()` and omit `richText` entirely (the extraction code already falls back `richText || text`, so supplying only `text` is a strictly valid input, not a partial implementation).
  - `props.name` — bound text is handled via `getLabel`; Deviva Draw has no separate "frame name" concept unless frames are added — omit unless frame support is scoped in.
  - `props.arrowheadStart`/`props.arrowheadEnd` — direct mapping from phase 08's `ArrowElement.startArrowhead`/`endArrowhead`, translating Deviva Draw's arrowhead enum (`none|arrow|bar|dot|triangle`) to strings the extractor's `isArrowhead()` check (`value !== "none"`) already handles correctly as long as `"none"` is the exact string used for no-arrowhead — verify this string match explicitly in a test, it's a one-character-typo-away class of bug.
  - Bindings — phase 08's `startBinding`/`endBinding` (`{elementId, focus, gap}`) map to `CanvasArrowBindingInput {fromId: arrow.id, toId: elementId, terminal: 'start'|'end'}` — direct translation.
- Publishing shape: keep the source-only `workspace:*` pattern (phase 01 decision) for the monorepo-internal consumer if `deviva-draw` and `deviva` are ever merged into one workspace — but they are **separate repos** (per this task's setup), so `deviva/apps/web` must consume `@deviva-draw/react` as a **real published package** (npm, or a private registry / git-dependency / tarball, decide based on whether Deviva Draw is meant to be open-sourced — flagged as an open question, default recommendation: npm public package since MIT-from-scratch has no licensing reason to stay private, matching the marketing-story motivation for building from scratch at all).
- `<DevivaDraw/>`'s public props surface must support what `design-canvas.tsx` currently does with tldraw: `persistenceKey`-equivalent (phase 11's localStorage autosave, parameterized by key instead of hardcoded), `onMount`-equivalent exposing an imperative API object, `theme="dark"` prop (phase 12), and a scene-change subscription with the same "user-authored changes only, not pan/zoom/selection noise" filtering `design-canvas.tsx:44-51` relies on (`{source: "user", scope: "document"}` in tldraw's API) — Deviva Draw's `Scene.subscribe` (phase 02) needs an equivalent scope filter, or the adapter must filter client-side by diffing versions.

## Requirements
- `@deviva-draw/react` public API: `<DevivaDraw persistenceKey theme onReady={(api) => void} />`, imperative `api.getSceneElements()`/`api.readDiagram()`, `api.subscribe(callback, {onlyUserChanges: true})`.
- `read-deviva-draw-diagram.ts`: adapter producing `CanvasShapeInput[]`/`CanvasArrowBindingInput[]` from a Deviva Draw `Scene`, calling into `extractDiagram` unchanged (or a Deviva-Draw-local copy of `extractDiagram` if `@deviva/shared`'s diagram types aren't meant to be imported cross-repo — decide: recommend keeping `extractDiagram` itself in `deviva/apps/web` as today, since it's genuinely tool-agnostic already, and only the adapter lives in/is consumed via `@deviva-draw/react` or a small new adapter file in `deviva` itself, mirroring today's file split).
- Package README + a minimal usage example (Vite + Next.js consumption both documented, since two different app shells consume this package: `apps/web` here via Vite, `deviva/apps/web` via Next.js).
- Integration change in `deviva`: replace `Tldraw`/`tldraw.css` imports in `design-canvas.tsx` with `DevivaDraw`, delete `tldraw` from `deviva/apps/web/package.json`, verify `read-tldraw-diagram.ts` is replaced by the new adapter (or the existing `extract-canvas-diagram.ts` is reused as-is with only the adapter swapped, per above).
- Regression safety net: a fixture-based test asserting the AI interviewer's diagram extraction produces equivalent `CanvasDiagram` output for a representative scene drawn once in tldraw (captured as a fixture today) and once in Deviva Draw (captured after migration) — this is the real regression risk called out in the original research report and must not be skipped.

## Architecture
```
packages/react/src/
├── deviva-draw.tsx                    public <DevivaDraw/> component (composes phase 12's app shell)
├── imperative-api.ts                    getSceneElements/readDiagram/subscribe surface
└── scene-read/
    └── to-canvas-shape-input.ts         Deviva Draw element -> CanvasShapeInput/CanvasArrowBindingInput mapping (mirrors read-tldraw-diagram.ts's role, lives here so deviva.app just imports and calls extractDiagram with this adapter's output)

# In the deviva repo (separate project, changes tracked there — listed for completeness):
apps/web/components/design-canvas.tsx        modified: swap Tldraw -> DevivaDraw
apps/web/components/read-tldraw-diagram.ts    deleted (or kept temporarily behind a flag during rollout)
apps/web/package.json                          tldraw dependency removed, @deviva-draw/react added
```

## Related Code Files
- Create: `packages/react/src/deviva-draw.tsx`, `imperative-api.ts`, `scene-read/to-canvas-shape-input.ts` (+ `.test.ts` each)
- Create: `packages/react/README.md`
- Modify (separate `deviva` repo — coordinate as a linked follow-up PR there, not part of this repo's commits): `deviva/apps/web/components/design-canvas.tsx`, `deviva/apps/web/package.json`
- Delete (in `deviva` repo, after migration verified): `deviva/apps/web/components/read-tldraw-diagram.ts`

## Implementation Steps
1. Finalize `<DevivaDraw/>`'s public prop/imperative-API surface against `design-canvas.tsx`'s current usage pattern (re-read that file's exact needs, don't design in a vacuum).
2. Implement `to-canvas-shape-input.ts`: the field-mapping adapter per Key Insights, with explicit unit tests for every `GEO_KINDS` mapping (`rectangle→box`, `ellipse→ellipse`, `diamond→diamond`; note Deviva Draw has no `x-box`/`check-box`/`oval`/`rhombus`/`cloud` equivalents in V1 — document as N/A, not a gap, since those are tldraw-specific shape variants this project never had).
3. Implement `imperative-api.ts`: `getSceneElements()` returns raw elements, `readDiagram()` runs the adapter + `extractDiagram` and returns a `CanvasDiagram` directly (convenience wrapper so `deviva.app` can call one function instead of importing `extractDiagram` separately — matches the original file split's spirit but reduces integration surface area).
4. Implement the "user-changes-only" subscription filter (compare pre/post scene state, ignore camera-only or selection-only changes) — needed to replicate `design-canvas.tsx:44-51`'s debounce trigger condition exactly.
5. Write package README with Vite and Next.js (`dynamic(..., {ssr:false})`, per the original research report's noted pitfall) usage examples.
6. Publish/package `@deviva-draw/react` (npm public, per the recommendation in Key Insights — confirm with user before first publish since it's a one-way door for a package name).
7. In the `deviva` repo (as a coordinated follow-up, separate PR/commit in that project): swap `design-canvas.tsx`'s `Tldraw` import for `DevivaDraw`, update `handleMount`→`onReady`, replace `readTldrawDiagram(editor)` calls with `api.readDiagram()`, remove `tldraw`/`tldraw.css` from `package.json`.
8. Regression test: capture a fixture scene (a handful of representative shapes/arrows/text — e.g. "load balancer → app server → database") drawn in both tools, assert `extractDiagram` output is equivalent (same nodes/edges/labels, allowing for id-format differences) between the tldraw-era fixture and the new Deviva-Draw-era one.
9. Manual QA in a real interview flow (or a close simulation) confirming the AI interviewer still reads diagrams correctly post-swap.

## Todo List
- [x] `<DevivaDraw/>` public API finalized and implemented (added `persistenceKey`; `onChange`/`theme`/`shareApiBaseUrl` already covered the rest of `design-canvas.tsx`'s needs)
- [x] `to-canvas-shape-input.ts` adapter implemented, every `GEO_KINDS` case unit tested (rectangle/ellipse/diamond map through verbatim; group membership deliberately never surfaces — see the module's own doc)
- [x] ~~`imperative-api.ts` implemented (`getSceneElements`, `readDiagram`, filtered `subscribe`)~~ — superseded: `getSceneElements` already existed on the imperative handle; a separate `readDiagram`/`subscribe` surface turned out unnecessary once `onChange(elements)` + the new `toCanvasShapeInput(elements)` pure function covered the same need with less surface area (the host's own `onChange` handler calls `toCanvasShapeInput` directly, no imperative round-trip required)
- [x] Package README with Vite + Next.js usage examples
- [ ] `@deviva-draw/react` published (or packaging decision finalized if not npm) — not done; the deviva integration currently consumes it via pnpm's `link:` protocol against a sibling checkout (dev-only), a real publish/consumption decision is still open
- [x] `deviva` repo: `design-canvas.tsx` swapped to `<DevivaDraw/>`, `read-excalidraw-diagram.ts` deleted and replaced — **caveat:** `@excalidraw/excalidraw` itself is still a `deviva/apps/web` dependency because `components/marketing/screenshot-rig-canvas.tsx` (unrelated to this integration) still imports it directly; full removal needs that file migrated too
- [x] Regression fixture test: prior-adapter-era vs Deviva-Draw-era `CanvasDiagram` output equivalence (deviva's own drawing tool at integration time was Excalidraw, not tldraw — see `read-deviva-draw-diagram.test.ts`)
- [ ] Manual interview-flow QA pass confirming diagram reading still works — not performed in this session (no running interview environment); typecheck + build + the regression fixture stand in for now

## Success Criteria
- `deviva/apps/web` builds and runs with zero `tldraw` references remaining.
- Drawing a representative system-design diagram in the new canvas produces a `CanvasDiagram` the AI interviewer consumes identically to before (verified by the regression fixture test).
- Package consumable from both a Vite app (`apps/web` in this repo) and a Next.js app (`deviva/apps/web`) without SSR crashes.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Field-mapping adapter misses an edge case tldraw handled implicitly (e.g. a shape type deviva's interviewer relies on that Deviva Draw doesn't have a direct equivalent for) | Medium | Medium | Regression fixture test built from real/representative interview diagrams, not synthetic minimal cases, before declaring this phase done |
| Cross-repo coordination (this repo publishes a package, `deviva` repo consumes it) causes version drift | Medium | Low | Semantic-version the package from the first publish; `deviva`'s `package.json` pins an exact/caret range, bump deliberately, not via floating `latest` |
| npm package name unavailable / naming decision needs revisiting | Low | Low | Confirm package name availability before implementation step 6, not after |

## Security Considerations
- No new attack surface beyond what phases 02–12 already established — this phase is integration/packaging, not new functionality.

## Next Steps
- Blocks: 16 only loosely (marketing site doesn't require the deviva.app swap to have happened, but this phase validates the lib package is genuinely reusable before phase 16 builds the marketing app on the same package).
- This phase's `deviva` repo changes are **out of this plan's git history** (different repo) — track them as a linked follow-up task once this phase's package is published.
- Rollback: `deviva`'s swap is a single component + one dependency change — revertible by reverting that repo's commit and re-adding tldraw, independent of this repo's state.
