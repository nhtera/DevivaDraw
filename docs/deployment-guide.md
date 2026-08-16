# Deployment & Publishing Guide

How to run Deviva Draw locally, publish the packages to npm, and deploy the app
and collaboration backend.

Day to day none of this is manual: GitHub Actions deploys both Workers on every
push to `main` and publishes the packages on every `v*` tag. See
[Continuous integration & deployment](#continuous-integration--deployment) for
the pipelines and the one-time credential setup they need. The manual commands
below are the fallback and the thing the pipelines actually run.

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

Normally `release.yml` does this on a `v*` tag — see
[Cutting a release](#cutting-a-release). What follows is the same sequence run
by hand, for a local dry run or if Actions is unavailable.

Packages are published under the `@deviva-draw` scope. `publishConfig` in each
package already sets `access: public` and points the published entry at the
`tsc`-built `dist/`.

1. `pnpm login` — the `@deviva-draw` scope/org must exist on npmjs.com (or
   change the scope in each `packages/*/package.json`).
2. `pnpm run build:packages` — builds in dependency order (engine →
   collab-client → react).
3. Dry run: `pnpm publish -r --dry-run --no-git-checks`, and confirm each
   tarball includes `dist/`, `src/`, `README.md`, and `LICENSE`.
4. `pnpm publish -r --access public --no-git-checks --otp <code>`.

The `--otp` is required: publishing access is set to *require 2FA and disallow
bypass-2fa tokens*, so a manual publish needs a genuine authenticator code.
Only the OIDC path in `release.yml` is exempt. Alternatively, stage the publish
and approve it out of band — `pnpm stage publish -r --access public`, then
`pnpm stage list` and `pnpm stage approve <stage-id> --otp <code>`.

Use `pnpm publish`, not `npm publish`. Internal deps are declared as
`workspace:*`, and it's pnpm that rewrites them to the real version range while
packing — `npm` would publish the unresolved specifier and produce an
uninstallable package. `-r` also walks the workspace topologically, skips the
two `private: true` apps, and skips any package whose version is already on the
registry, so it is safe to re-run.

Bump versions with your preferred flow; each package is independently versioned.

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
2. `pnpm --filter @deviva-draw/collab-server run deploy` (the Durable Object
   migration is declared in `wrangler.jsonc`). The `run` is required, not
   stylistic: `pnpm deploy` is a built-in pnpm command that copies a workspace
   package into a directory, and it shadows the package's own deploy script.
3. Add your web app's production origin to `ALLOWED_ORIGINS` in
   `apps/collab-server/src/index.ts` if it differs from the default.

## Continuous integration & deployment

Two workflows in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | PRs to `main`, pushes to `main` | Typecheck, lint, unit tests, full build; Playwright e2e in a parallel job. On `main` only, then deploys the collab Worker, the web Worker, and the docs site (`apps/docs` → `docs-draw.deviva.app`, assets-only Worker like the web app). |
| `release.yml` | `v*` tags, manual dispatch | Re-runs the gates, builds the packages, publishes them to npm with provenance. |

Deploys are gated on `needs: [build, e2e]`, so a red build or a failing e2e run
blocks production. The collab server deploys before the web app: the frontend
calls that origin, so on a change touching both, the API should be live first.

E2E runs in its own job so the ~100MB Chromium download never delays typecheck
and lint feedback. The browser is cached against the resolved Playwright version
rather than the lockfile hash, so unrelated dependency bumps don't evict it.

### One-time setup: Cloudflare

Both deploy jobs shell out to `wrangler`, which needs two repository secrets
(**Settings → Secrets and variables → Actions**):

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token. Needs **Edit Cloudflare Workers**, plus **Workers R2 Storage: Edit** for the buckets and **Zone: DNS: Edit** on `deviva.app` so the `custom_domain` routes can provision. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID. Not a secret in the cryptographic sense, but keeping it alongside the token avoids hardcoding it. |

The R2 buckets must exist before the first deploy — see
[Deploy the collaboration backend](#deploy-the-collaboration-backend-cloudflare).

Both jobs target a `production` GitHub environment, so required reviewers or a
wait timer can be added later without touching the workflow.

### One-time setup: npm trusted publishing

`release.yml` authenticates to npm over OIDC. There is deliberately **no
`NPM_TOKEN`**: npm is retiring 2FA-bypass granular access tokens — they lose
account-management powers from August 2026 and lose direct publish entirely
around January 2027 — so a long-lived publish token would be a dead end. OIDC
also makes npm attach a provenance attestation automatically, linking each
tarball to the workflow run and commit that produced it.

For each of `@deviva-draw/engine`, `@deviva-draw/collab-client`, and
`@deviva-draw/react`, on npmjs.com → the package → **Settings → Trusted
Publisher**:

- Publisher: **GitHub Actions**
- Organization / repository: `nhtera` / `DevivaDraw`
- Workflow filename: `release.yml`
- Environment: leave blank (the job doesn't declare one)
- Allowed actions: **both** `npm publish` and `npm stage publish`. The first is
  what `release.yml` actually uses. The second costs nothing and keeps the
  staged flow available as a fallback — pnpm implements it end to end, and a
  staged publish can't go live without a human approving it with 2FA.

Then, under **Publishing access** on the same settings page, choose *"Require
two-factor authentication and disallow bypass 2fa tokens"*. OIDC trusted
publishing is unaffected by that setting, so `release.yml` keeps working; it
only removes the token class npm is retiring anyway. The tradeoff is that
publishing by hand then needs a real OTP — see
[Publish the packages to npm](#publish-the-packages-to-npm).

All three packages already exist on the registry, so no bootstrap publish is
needed. If a *new* package is added to the scope later, publish its first
version manually — trusted publishing can only be configured on a package that
exists.

### Cutting a release

Packages are versioned independently, and `pnpm publish -r` skips any version
already on the registry. So a release is just:

1. Bump the `version` in whichever `packages/*/package.json` changed.
2. Update `CHANGELOG.md`.
3. Commit, then `git tag v0.4.0 && git push --tags`.

Only the bumped packages publish; the untouched ones are silently skipped. The
tag name is a label for the release as a whole — it doesn't have to match any
single package's version.

## Notes

- **Hand-drawn font.** The engine ships OS font stacks; a licensed/commissioned
  hand-drawn font drops into `text/font-loading.ts` sources with no call-site
  changes.
- **Follow mode.** Following a peer's viewport exists in the collab client but is
  not yet wired into the React chrome.

## See also

- [Codebase Summary](./codebase-summary.md)
- [Project Roadmap](./project-roadmap.md)
