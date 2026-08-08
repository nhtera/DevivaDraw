# Phase 16 — Marketing Site & Deployment

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §13 (Product/Infra)
- Depends on: `phase-12-ui-chrome-shortcuts-mobile-theming-i18n.md`, `phase-13-share-links-e2e-encryption.md`, `phase-15-react-lib-package-and-deviva-integration.md` (soft: `phase-14` — collab can be featured once stable, not a hard gate)

## Overview
- **Priority:** 🔴 (this is the actual product launch — everything else was building toward this)
- **Status:** pending
- Ship `draw.deviva.app`: a landing page around the `<DevivaDraw/>` app shell (built in phase 12, consumed here exactly as `deviva.app` will consume it in phase 15 — `apps/web` in this repo is effectively the dogfood/reference integration), SEO/OG metadata, analytics, error tracking, and production deployment to Cloudflare.

## Key Insights
- `apps/web` has been the dev harness since phase 03 — this phase is where it becomes the real product, not a new build. The landing page (marketing copy, hero, feature highlights) wraps around the same composed `<DevivaDraw/>` shell from phase 12, it doesn't reimplement anything canvas-related.
- Deploy target: **Cloudflare Pages** for the static/SPA shell (Vite build output — matches the phase 01 architecture decision to use Vite over Next.js specifically because this is a CSR app with no SSR needs) — distinct from `deviva/apps/web`'s Cloudflare Workers + `@opennextjs/cloudflare` deploy (that pattern is for a Next.js SSR app and doesn't apply here). `apps/collab-server` deploys separately as its own Worker (already established in phases 13/14).
- Domain: `draw.deviva.app` as a custom domain on the Cloudflare Pages project, mirroring `deviva.app`'s `wrangler.jsonc` custom-domain pattern (`routes: [{pattern, custom_domain: true}]` — Pages uses a similar custom-domain binding, confirm exact Pages-vs-Workers config syntax at implementation time since they differ slightly from the Workers `routes` block referenced in `deviva/apps/web/wrangler.jsonc`).
- Error tracking/analytics: reuse whatever provider `deviva.app` already uses if one is standardized (check `deviva`'s codebase for an existing Sentry/PostHog/etc. integration before introducing a new one — DRY at the organizational level, avoid a second analytics vendor for no reason). This wasn't confirmed in this planning pass — flag as an implementation-time lookup, not a blind new-tool introduction.
- Analytics events worth tracking for a whiteboard product: scene created, export triggered, share link created, collab session started — product-relevant funnel events, not just pageviews.

## Requirements
- Landing/marketing shell: hero, feature highlights (tied to the real feature set built in phases 01–14, not aspirational copy), CTA into the app.
- SEO: meta tags, OG image (a rendered example diagram, generated via phase 11's export pipeline — dogfooding again), sitemap, robots.txt.
- Analytics: pageview + the product funnel events listed in Key Insights.
- Error tracking: client-side error boundary + reporting (provider TBD per Key Insights' lookup note).
- Cloudflare Pages deployment: production build, preview deployments per PR (Cloudflare Pages' native git-integration feature), custom domain `draw.deviva.app`.
- `apps/collab-server` production deployment (Worker, already built phases 13/14) on its own subdomain (e.g. `collab.draw.deviva.app` — confirm with user per `plan.md` unresolved question #2).

## Architecture
```
apps/web/src/
├── routes/
│   ├── landing.tsx            marketing page (hero, features, CTA)
│   └── app.tsx                 the actual whiteboard (phase 12's <DevivaDraw/> shell, already exists)
├── seo/
│   ├── meta-tags.ts
│   └── generate-og-image.ts     uses phase 11's export-to-png against a fixture scene
├── analytics/analytics-client.ts
└── error-tracking/error-boundary.tsx
wrangler config for Pages (or pages.json / Pages dashboard project settings, depending on final Cloudflare Pages config approach at implementation time)
```

## Related Code Files
- Create: `apps/web/src/routes/landing.tsx`, `seo/meta-tags.ts`, `seo/generate-og-image.ts`, `analytics/analytics-client.ts`, `error-tracking/error-boundary.tsx`
- Create: `apps/web/public/robots.txt`, `apps/web/public/sitemap.xml` (or generated at build time)
- Create: Cloudflare Pages project config (exact file depends on chosen approach — `wrangler.jsonc` with `pages_build_output_dir`, or dashboard-configured; decide at implementation time based on current Wrangler version's recommended Pages workflow)
- Modify: `apps/collab-server/wrangler.jsonc` (production route/custom domain for collab subdomain)

## Implementation Steps
1. Build `landing.tsx`: hero + feature highlights grounded in what's actually shipped (cross-check against `plan.md`'s milestone table — don't market phase 14 collab as live if it hasn't shipped yet).
2. Implement `generate-og-image.ts`: a build-time or edge-rendered OG image using phase 11's PNG export against a curated example scene (own dogfooding, no external design tool needed).
3. Implement SEO meta tags, `robots.txt`, sitemap.
4. Look up `deviva`'s existing analytics/error-tracking provider (if any) before selecting one here; implement `analytics-client.ts` and `error-boundary.tsx` against that decision.
5. Wire the product funnel events (scene created, export, share link created, collab started) at their natural call sites (phase 11's export function, phase 13's share action, phase 14's `useCollabSession` connect event) — instrumentation points added as small hooks into already-built code, not new logic.
6. Configure Cloudflare Pages project for `apps/web` (production build command, output directory, custom domain `draw.deviva.app`, preview deployments on PRs).
7. Deploy `apps/collab-server` to production (`wrangler deploy`), configure its production subdomain and CORS/WebSocket-origin allowlist to only accept connections from `draw.deviva.app` (and later `deviva.app` once phase 15's integration is live there too).
8. Production smoke test: full user journey (visit landing → open app → draw → export → share link → open share link in a second browser) against the live deployed URLs.
9. Set up basic uptime/deploy-failure alerting (Cloudflare's built-in deployment notifications at minimum; deeper observability is a future-phase concern, not blocking launch).

## Todo List
- [ ] Landing page built, copy matches actually-shipped features
- [ ] OG image generation working (real export pipeline, not a static asset)
- [ ] SEO meta/robots/sitemap in place
- [ ] Analytics provider decided (reused from deviva.app if one exists) and funnel events wired
- [ ] Error tracking wired
- [ ] `apps/web` deployed to Cloudflare Pages with custom domain `draw.deviva.app`
- [ ] `apps/collab-server` deployed to production with origin allowlist configured
- [ ] Full production smoke test (draw → export → share → collab) passing on live URLs

## Success Criteria
- `https://draw.deviva.app` loads the landing page, CTA opens a functional whiteboard.
- Lighthouse/basic SEO check passes (meta tags present, OG image renders in a link-preview simulator).
- Production smoke test journey completes without errors on the deployed environment (not just localhost).
- Preview deployments work for subsequent PRs (validates the ongoing deploy pipeline, not just this one launch).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cloudflare Pages vs Workers config drift/confusion (two different products, easy to mix conventions from `deviva/apps/web`'s Workers-based `wrangler.jsonc`) | Medium | Medium | Explicitly verify current (2026) Cloudflare Pages deployment method at implementation time rather than assuming the Workers pattern transfers directly — flagged as an implementation-time doc check, not assumed here |
| Marketing copy overstates unshipped features (e.g. collab) | Medium | Low (credibility, not technical) | Copy review gated against `plan.md`'s actual milestone completion state at ship time |
| Collab server origin allowlist too permissive (accepts connections from any origin) | Medium | Medium (abuse surface) | Explicit CORS/WebSocket-origin check in `apps/collab-server`, allowlisting only known production domains, tested |

## Security Considerations
- Origin allowlist on `apps/collab-server`'s WebSocket upgrade handler (see Risk Assessment) — prevents arbitrary third-party sites from embedding/relaying through the collab infrastructure.
- Standard web security headers (CSP, etc.) on the Pages deployment — baseline hardening, not previously needed for a dev-only harness.

## Next Steps
- This phase is the V1 launch milestone (M4 in `plan.md`). Post-launch: monitor real usage, prioritize any deferred items (elbow arrows if slipped in phase 08, SVG font embedding if slipped in phase 11, multi-scene workspaces, shape libraries, mermaid/AI text-to-diagram from the feature inventory's §12 extras) as a fast-follow backlog rather than blocking this launch.
- Rollback: Cloudflare Pages retains prior deployments — instant rollback to the last-known-good build via the Pages dashboard/CLI if a production issue surfaces.
