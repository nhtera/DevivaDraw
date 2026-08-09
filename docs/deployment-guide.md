# Deployment & Publishing Guide

Status: pre-launch. Phases 01–15 built and committed; phase 16 (marketing site
+ production deploy) not started. npm publish pending user verification.

## Local verification (current state)

```bash
# deviva-draw standalone app + collab worker
cd ~/Code/projects/deviva-draw
pnpm install
pnpm dev            # web on :5173, collab worker on :8788
pnpm typecheck && pnpm lint && pnpm test   # 1058+158+111+71 unit, 12 e2e

# deviva.app integration (working-tree changes, NOT committed there)
cd ~/Code/projects/deviva
pnpm install        # resolves link: deps to ../deviva-draw
pnpm dev:web        # interview design canvas now runs <DevivaDraw/>
```

Share links + collab locally: `apps/web` needs the worker running (`pnpm
dev:collab`); share/collab menu entries appear only when `shareApiBaseUrl` is
configured (see `apps/web/src/share-api-config.ts`).

## npm publish runbook (when ready)

1. Confirm the placeholder repo URL (`github.com/deviva/deviva-draw`) in the
   three `packages/*/package.json` `repository`/`homepage`/`bugs` fields.
2. `npm login` (needs the @deviva-draw scope/org created on npmjs.com, or
   change the scope).
3. `pnpm run build:packages` (engine → collab-client → react).
4. Dry-run each: `npm publish --dry-run` inside each package dir.
5. Publish in order: engine, collab-client, react (`npm publish --access
   public` in each; publishConfig already sets access).
6. In deviva `apps/web/package.json`: replace the `link:` deps with the
   published versions (e.g. `"@deviva-draw/react": "^0.1.0"`), `pnpm install`,
   re-run typecheck/tests/build, then commit the deviva-side swap.
   **Do not merge the deviva changes while they use `link:` — CI/deploy will
   fail** (runners have no sibling checkout).

## Cloudflare (collab-server) — when deploying

- Create buckets once: `wrangler r2 bucket create deviva-draw-share-blobs`
  and `deviva-draw-rooms`.
- `pnpm --filter @deviva-draw/collab-server deploy` (Durable Object migration
  `new_sqlite_classes` is in wrangler.jsonc).
- Add the production origin to `ALLOWED_ORIGINS` in
  `apps/collab-server/src/index.ts` if the domain differs from
  `draw.deviva.app`.

## Known open items

- Phase 16 not started: marketing site, draw.deviva.app deploy (Cloudflare
  Pages/Workers), production DNS for the collab worker.
- deviva `apps/web/components/marketing/screenshot-rig-canvas.tsx` still uses
  `@excalidraw/excalidraw` (out of integration scope) — migrate or accept the
  dual dependency before removing the excalidraw package.
- Hand-drawn font: engine's font slot ships OS stacks; a licensed/commissioned
  hand-drawn font drops into `text/font-loading.ts` sources with no call-site
  changes.
- Follow-mode UI (follow a peer's viewport) exists in collab-client but is not
  wired into the React chrome.
