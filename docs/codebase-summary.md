# Codebase Summary

Deviva Draw: infinite-canvas whiteboard built clean-room (no Excalidraw code).
pnpm monorepo, source-only packages (no build step for consumers). Node 22+.

Status: **M1 (solo whiteboard MVP) complete** — phases 01-11 done. M2 (UI
chrome, share links), M3 (collab), M4 (product integration) pending.

## Layout

```
packages/engine         @deviva-draw/engine — framework-agnostic core
packages/react          @deviva-draw/react — <DevivaDraw/> component, hooks
packages/collab-client  WS sync client, E2E crypto, presence (stub, M3)
apps/web                draw.deviva.app — Vite + React 19 SPA
apps/collab-server      Cloudflare Worker: Durable Objects + R2 (stub, M3)
```

## packages/engine/src

| Dir | Responsibility |
|---|---|
| `elements/` | Element model — `BaseElement` + per-type factories (generic, arrow, freedraw, shape, text, image). All fields immutable after creation except via `touch()`. |
| `scene/` | `Scene` store (Map-based CRUD, pub-sub), fractional-index z-order, update-hook middleware, files store. |
| `history/` | `HistoryStack<T>` — undo/redo with batch begin/commit/cancel. |
| `input/` | `PointerEventPipeline`, `ToolStateMachine`, `ToolHandler` contract, pan/zoom, shortcuts, DOM adapters. |
| `render/` | `Camera`, viewport culling, per-element renderers (rough shapes, freedraw, text, image, arrow), `StaticLayer`/`InteractiveLayer`/`CanvasStage` dual-layer compositor, per-element drawable caches. |
| `tools/` | Concrete `ToolHandler`s: rectangle/ellipse/diamond/line, freedraw, text, arrow (+ endpoint binding), shared drag-shape base, style state. |
| `selection/` | Hit-test, marquee, resize/rotate handles, group transform, align/distribute, group/ungroup, snapping, clipboard, z-order ops, `SelectionTool`. |
| `bindings/` | Arrow-to-shape binding model, border intersection math, binding recompute, scene-sync hooks, arrow labels. |
| `text/` | Font loading, text measurement/wrap (injectable `TextMeasurer`), bound-text layout/lifecycle, text edit session. |
| `images/` | Content-addressed file store (`FilesMap`), image insert (resize/validate), `ImageDecodeCache` (injectable decoder). |
| `persistence/` | `SceneDocumentV1` schema, migrations registry, validation, serialize/deserialize, localStorage autosave. |
| `export/` | Export geometry, PNG (with embedded scene data via tEXt chunk), SVG, copy-as-image. |

Public API surface: `packages/engine/src/index.ts` — the only import path
consumers (react package, apps) should use; internal modules are not a
supported surface.

## packages/react/src

- `index.ts` — package entry, re-exports hooks/components.
- `components/text-editor-overlay.tsx` — WYSIWYG `<textarea>` overlay for in-place text/bound-text editing.
- `hooks/use-text-editing.ts` — drives `TextEditSession` lifecycle from React.
- `hooks/use-paste-and-drop.ts` — paste/drop-to-insert-image wiring.
- `hooks/clipboard-image-detection.ts` — injectable clipboard-event predicates (testable without real `ClipboardEvent`/DOM).
- `hooks/should-commit-on-enter.ts` — Enter-vs-Shift+Enter text-commit logic.

## apps/web/src

Vite SPA dev harness exercising the full engine end-to-end (not yet the
final production UI — that's phase 12/15 scope):
- `app.tsx`, `main.tsx` — app shell.
- `dev-canvas-harness*.ts(x)` — canvas wiring split by concern (runtime, actions, shortcuts, double-click, persistence, tool names, types) — each kept under the 200-line file-size rule.
- `browser-image-decode.ts`, `persistence-adapters.ts` — browser-side adapters for engine injection points (`ImageDecodeFn`, autosave `StorageLike`).
- `find-arrow-at-point.ts`, `find-bindable-container-at-point.ts` — hit-test glue for the dev harness.
- `e2e/smoke.spec.ts` — 1 Playwright test: app shell loads, title correct, engine version visible.

## apps/collab-server/src

- `index.ts` — placeholder Cloudflare Worker entry; Durable Objects rooms and R2 blob storage are M3 scope (phase 14), not yet implemented.

## packages/collab-client/src

- `index.ts` — placeholder package entry; WS transport, E2E crypto, presence are M3 scope.

## Dependencies (production)

| Package | Dep | Purpose |
|---|---|---|
| engine | `roughjs` ^4.6.6 | hand-drawn/sketchy shape rendering |
| engine | `perfect-freehand` ^1.2.3 | pressure-sensitive freehand stroke outlines |
| engine | `fractional-indexing` ^4.0.0 | z-order index generation between elements |
| react | `@deviva-draw/engine` (workspace) | — |
| web | `react`/`react-dom` 19.2.4, engine, react pkg | — |

All three are small, single-purpose MIT libs — consistent with the plan's
locked decision: zero Excalidraw code, small MIT deps OK.

## Test counts (as of M1 completion)

- `packages/engine`: 991 tests (Vitest, Node environment — no real DOM canvas needed for geometry/history/serializers; injectable abstractions stand in for DOM elsewhere).
- `packages/react`: 22 tests (Vitest).
- `apps/web`: 1 Playwright e2e test (smoke).

## See also

- [System Architecture](./system-architecture.md)
- [Code Standards](./code-standards.md)
- [Project Roadmap](./project-roadmap.md)
