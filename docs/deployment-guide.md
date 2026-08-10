# Deployment & Publishing Guide

How to run Deviva Draw locally, publish the packages to npm, and deploy the app
and collaboration backend.

## Run locally

```bash
git clone https://github.com/nhtera/DevivaDraw.git
cd DevivaDraw
pnpm install
pnpm dev            # web app on :5173, collab worker on :8788
pnpm test           # unit suites + web e2e
pnpm typecheck && pnpm lint
```

Share links and collaboration require the collab worker running (`pnpm dev`
starts it alongside the web app). The Share/Collaborate menu entries appear only
when `shareApiBaseUrl` is configured — see `apps/web/src/share-api-config.ts`.

## Publish the packages to npm

Packages are published under the `@deviva-draw` scope. `publishConfig` in each
package already sets `access: public` and points the published entry at the
`tsc`-built `dist/`.

1. `npm login` — the `@deviva-draw` scope/org must exist on npmjs.com (or change
   the scope in each `packages/*/package.json`).
2. `pnpm run build:packages` — builds in dependency order (engine →
   collab-client → react).
3. Dry-run each: `npm publish --dry-run` inside each package directory, and
   confirm the tarball includes `dist/`, `src/`, `README.md`, and `LICENSE`.
4. Publish in order: `engine`, then `collab-client`, then `react`
   (`npm publish` in each package directory).

Bump versions with your preferred flow (each package is independently
versioned); keep the workspace `workspace:*` internal deps — pnpm rewrites them
to the published version range at pack time.

### Embedding via a local checkout (before publishing)

A sibling repo can consume the packages without publishing, using pnpm `link:`
deps that resolve to `../DevivaDraw/packages/*`. Because packages are served
from TypeScript source in dev, no build step is needed. Replace `link:` deps
with published versions before committing or deploying the consuming repo — CI
runners have no sibling checkout, so `link:` deps break there.

## Deploy the web app

`apps/web` is a static Vite build:

```bash
pnpm --filter @deviva-draw/web build   # outputs apps/web/dist
```

Serve `apps/web/dist` from any static host (Cloudflare Pages, Netlify, etc.).
Set `shareApiBaseUrl` to your deployed collab worker's origin to enable share
links and collaboration.

## Deploy the collaboration backend (Cloudflare)

`apps/collab-server` is a Cloudflare Worker with Durable Objects and R2:

1. Create the buckets once:
   `wrangler r2 bucket create deviva-draw-share-blobs` and
   `wrangler r2 bucket create deviva-draw-rooms`.
2. `pnpm --filter @deviva-draw/collab-server deploy` (the Durable Object
   migration is declared in `wrangler.jsonc`).
3. Add your web app's production origin to `ALLOWED_ORIGINS` in
   `apps/collab-server/src/index.ts` if it differs from the default.

## Notes

- **Hand-drawn font.** The engine ships OS font stacks; a licensed/commissioned
  hand-drawn font drops into `text/font-loading.ts` sources with no call-site
  changes.
- **Follow mode.** Following a peer's viewport exists in the collab client but is
  not yet wired into the React chrome.

## See also

- [Codebase Summary](./codebase-summary.md)
- [Project Roadmap](./project-roadmap.md)
