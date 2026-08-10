# Codebase Summary

Deviva Draw: an open-source, infinite-canvas whiteboard built clean-room (no
Excalidraw or tldraw code). pnpm monorepo, source-only packages (no build step
for in-repo consumers). Node 22+. MIT licensed.

A framework-agnostic engine, a React component library, a real-time collab
client, a standalone web app, and a Cloudflare Worker backend — a solo
whiteboard, an embeddable component, and a live-multiplayer canvas all share the
same core.

## Layout

```
packages/engine         @deviva-draw/engine — framework-agnostic core
packages/react          @deviva-draw/react — <DevivaDraw/> component, hooks, UI chrome
packages/collab-client  @deviva-draw/collab-client — WS sync, E2E crypto, presence
apps/web                Standalone web app — Vite + React SPA
apps/collab-server      Cloudflare Worker: Durable Objects rooms + R2 share blobs
```

## Element model

The scene is a set of immutable elements in an `AnyElement` discriminated union.
Element types currently supported:

`rectangle`, `ellipse`, `diamond`, `triangle`, `hexagon`, `star`, `cloud`,
`heart`, `x-box`, `check-box`, `line`, `arrow`, `freedraw` (incl. highlighter),
`block-arrow`, `text`, `note` (sticky note), `frame`, `image`, plus a `generic`
base.

## packages/engine/src

| Dir | Responsibility |
|---|---|
| `elements/` | Element model — `BaseElement` + per-type factories. All fields immutable after creation except via `touch()`. Shared shape geometry (polygon/block-arrow unit vertices) lives here as a single source of truth. |
| `scene/` | `Scene` store (Map-based CRUD, pub-sub), fractional-index z-order, update-hook middleware, files store. |
| `history/` | `HistoryStack<T>` — undo/redo with batch begin/commit/cancel. |
| `input/` | `PointerEventPipeline`, `ToolStateMachine`, `ToolHandler` contract, pan/zoom, shortcut registry, DOM adapters. |
| `render/` | `Camera`, viewport culling, per-element renderers (rough shapes, freedraw, text, image, arrow, frame), dual-layer `StaticLayer`/`InteractiveLayer` compositor, per-element drawable caches. |
| `tools/` | Concrete `ToolHandler`s: every shape, freedraw/highlighter, text, note, arrow/line, lasso, frame, eraser, laser; shared `DragShapeTool` base + style state. |
| `selection/` | Hit-test, marquee, lasso select, resize/rotate handles, group transform, align/distribute, group/ungroup, snapping, clipboard, z-order ops, frame membership, `SelectionTool`. |
| `bindings/` | Arrow-to-shape binding model, border intersection math, binding recompute, scene-sync hooks, arrow labels. |
| `text/` | Font loading, text measurement/wrap (injectable `TextMeasurer`), bound-text layout/lifecycle for bindable containers, text edit session. |
| `images/` | Content-addressed file store (`FilesMap`), image insert (resize/validate), `ImageDecodeCache` (injectable decoder). |
| `persistence/` | `SceneDocumentV1` schema, migrations registry, validation, serialize/deserialize, localStorage autosave. |
| `export/` | Export geometry, PNG (scene embedded via tEXt chunk), SVG, copy-as-image. |

Public API surface: `packages/engine/src/index.ts` — the only import path
consumers (react package, apps) should use; internal modules are not a supported
surface.

## packages/react/src

The React adapter — a thin layer over the engine, no engine internals assume
React or a DOM.

- `index.ts` — package entry, re-exports the `<DevivaDraw/>` component, hooks, and scene-read helpers.
- `components/` — the full UI chrome: toolbar, more-tools overflow menu, main menu (open/save/export/theme/language), style panel, context menu, shortcuts dialog, command palette, share & collab dialogs, canvas hint, text-editor overlay.
- `runtime/` — wires engine tools, actions, and render loop into the React tree (`use-deviva-runtime`, `build-tools`, `build-runtime`, `start-render-loop`).
- `theme/` — light/dark/system theme provider, tokens, and storage.
- `i18n/` — translation catalogs (English + Vietnamese) and `useTranslation`.
- `hooks/` — text editing, paste/drop-to-insert-image, clipboard detection, Enter-vs-Shift+Enter commit logic.

## packages/collab-client/src

Real-time sync client: WebSocket transport, an end-to-end crypto layer (the
session key stays in the URL, never on the wire), presence, and conflict
resolution built on the engine's `version`/`versionNonce` invariant.

## apps/web/src

The standalone web app — a Vite + React SPA that mounts `<DevivaDraw/>` with
localStorage autosave, share-link routing (`/s/…`), and collab-room routing
(`/room/…`).

## apps/collab-server/src

Cloudflare Worker backend: Durable Objects host per-room collaboration sessions;
R2 stores encrypted share-link blobs. `ALLOWED_ORIGINS` gates cross-origin
access.

## Dependencies (production)

| Package | Dep | Purpose |
|---|---|---|
| engine | `roughjs` | hand-drawn/sketchy shape rendering |
| engine | `perfect-freehand` | pressure-sensitive freehand stroke outlines |
| engine | `fractional-indexing` | z-order index generation between elements |
| react | `@deviva-draw/engine`, `@deviva-draw/collab-client` (workspace) | — |

All third-party runtime libs are small, single-purpose, and MIT/CC0 — consistent
with the project's locked decision: zero Excalidraw code, small permissive deps
OK. See [LICENSE-THIRD-PARTY](../LICENSE-THIRD-PARTY).

## Tests

The suite runs across every package and the web app:

- `packages/engine` — the bulk of the tests (Vitest, Node environment; geometry,
  history, serializers, tools, selection, bindings all run DOM-free via
  injectable abstractions).
- `packages/react` — hook and component logic (Vitest).
- `packages/collab-client` — transport, crypto, presence (Vitest).
- `apps/collab-server` — Worker/Durable Object logic (Vitest).
- `apps/web` — Playwright end-to-end (pointer-driven scene assertions).

Run everything with `pnpm test` from the repo root.

## See also

- [System Architecture](./system-architecture.md)
- [Code Standards](./code-standards.md)
- [Project Roadmap](./project-roadmap.md)
- [Deployment Guide](./deployment-guide.md)
