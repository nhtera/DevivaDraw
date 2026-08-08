# Deviva Draw

Infinite-canvas whiteboard built from scratch: a framework-agnostic drawing
engine, a React component library, and a collaborative web app.

## Layout

```
packages/engine         Framework-agnostic core: element model, scene store,
                        history, renderer, geometry, input/tools
packages/react          @deviva-draw/react — <DevivaDraw/> component, hooks,
                        UI chrome, scene-read API for embedding
packages/collab-client  WebSocket sync client, E2E crypto, presence
apps/web                Standalone app (draw.deviva.app) — Vite + React SPA
apps/collab-server      Cloudflare Worker: Durable Objects rooms + R2 blobs
```

Packages are source-only (consumers compile TypeScript directly) — no build
artifacts to keep in sync.

## Setup

```bash
pnpm install
pnpm dev          # web app + collab server together
pnpm typecheck && pnpm lint && pnpm test
```

Requires Node 22+ and pnpm (pinned via `packageManager`).

## Plans

Implementation is phased; see `plans/` for the roadmap and per-phase specs.
