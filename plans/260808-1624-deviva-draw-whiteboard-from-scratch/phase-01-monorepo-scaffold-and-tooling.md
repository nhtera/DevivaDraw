# Phase 01 — Monorepo Scaffold & Tooling

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` (§13 product/infra)
- `deviva/package.json`, `deviva/pnpm-workspace.yaml`, `deviva/tsconfig.base.json` (conventions mirrored)
- Overview: `plan.md`

## Overview
- **Priority:** 🔴 blocking — nothing else starts without this
- **Status:** ✅ done (2026-08-08) — all success criteria verified: install/typecheck/lint/test green across 5 projects, Playwright smoke passes, wrangler dev responds 200 (port pinned to 8788; 8787 taken by another local tool), code-reviewed, initial commit made
- Stand up the pnpm workspace, shared TS config, lint/test tooling, and empty package/app skeletons so every later phase has a place to land code and a CI gate to pass.

## Key Insights
- deviva's root repo uses plain pnpm workspaces (`apps/*`, `packages/*`), no Turborepo — mirror that, don't introduce Turborepo unasked (YAGNI; add later only if build times demand it).
- deviva's `packages/shared` is source-only (`exports: "./src/index.ts"`, no build step, consumers compile TS directly). `packages/engine` and `packages/react` should follow the same pattern for dev velocity — but since `apps/web` is now Vite (not Next/Turbopack) and `deviva/apps/web` (Next) will eventually import `@deviva-draw/react` too, both consumers must support "compile TS directly" (Next via SWC, Vite via esbuild) — confirmed both do by default, so source-only exports work for both. Add a real `tsc` build step only in phase 15 when publishing for external Next.js consumption if source-only proves insufficient.
- `apps/web` is **Vite + React, not Next.js**: this app is 100% canvas/DOM interaction, no content needs SSR/SEO from React itself (marketing shell can be static HTML/meta, app is a CSR SPA behind it). Next.js would force `dynamic(..., {ssr:false})` workarounds for every canvas import (the exact pitfall noted in the tldraw research report) for zero benefit. Deploy target (Cloudflare Pages) supports static+SPA natively.
- `apps/collab-server` is a plain Cloudflare Worker project (its own `wrangler.jsonc`), not part of the Next/Vite app — Durable Objects are cleanest as an independently deployed Worker, matching deviva's existing pattern of independently-deployed services (web on Cloudflare, agent on Fly.io).

## Requirements
- pnpm workspace with `packages/*` and `apps/*`.
- Node >=22, pnpm pinned via `packageManager` field (match deviva's `pnpm@11.12.0` unless a newer pinned version is already in use — verify `pnpm -v` at scaffold time).
- Shared `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ES2023 target (copy deviva's base verbatim — proven config).
- Root scripts: `dev`, `build`, `typecheck` (`pnpm -r typecheck`), `lint` (`pnpm -r lint`), `test` (`pnpm -r test`).
- ESLint flat config shared across packages (kebab-case filename rule, max-lines 200 rule as a warning, not hard fail — matches "don't be too harsh on linting" rule).
- Vitest configured at each package root; Playwright configured in `apps/web`.
- Git init + `.gitignore` (node_modules, dist, .wrangler, .open-next equivalent build dirs).
- `LICENSE` (MIT for this codebase) + `LICENSE-THIRD-PARTY` stub listing rough.js, perfect-freehand, fractional-indexing licenses (populated as each is added).

## Architecture
```
deviva-draw/
├── package.json                 root scripts, packageManager pin
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.mjs
├── packages/
│   ├── engine/    (empty skeleton: package.json, src/index.ts placeholder, vitest.config.ts)
│   ├── react/     (same skeleton)
│   └── collab-client/ (same skeleton)
├── apps/
│   ├── web/       (Vite + React skeleton, playwright.config.ts)
│   └── collab-server/ (wrangler skeleton, no framework)
└── LICENSE, LICENSE-THIRD-PARTY
```

## Related Code Files
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.gitignore`, `LICENSE`, `LICENSE-THIRD-PARTY`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`, `packages/engine/src/index.ts`
- Create: `packages/react/package.json`, `packages/react/tsconfig.json`, `packages/react/vitest.config.ts`, `packages/react/src/index.ts`
- Create: `packages/collab-client/package.json`, `packages/collab-client/tsconfig.json`, `packages/collab-client/src/index.ts`
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/playwright.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`
- Create: `apps/collab-server/package.json`, `apps/collab-server/wrangler.jsonc`, `apps/collab-server/src/index.ts`

## Implementation Steps
1. `git init`; add `.gitignore`.
2. Root `package.json` + `pnpm-workspace.yaml` + `tsconfig.base.json` (copy deviva's compiler options).
3. `eslint.config.mjs` shared flat config (TS + React plugin for the two React-consuming packages).
4. Scaffold `packages/engine`, `packages/react`, `packages/collab-client` as source-only workspace packages (`workspace:*` cross-deps: react → engine, collab-client → engine).
5. Scaffold `apps/web` with Vite + React 19 (match deviva's React 19.2.4 pin for future compat), Tailwind (optional, decide in phase 12 — leave unstyled shell now).
6. Scaffold `apps/collab-server` with `wrangler.jsonc` (name `deviva-draw-collab`, `compatibility_flags: ["nodejs_compat"]`), placeholder `fetch` handler returning 200.
7. Wire `pnpm install`, verify `pnpm -r typecheck` and `pnpm -r test` pass on empty skeletons.
8. Add root `README.md` pointing to `plans/` and this monorepo layout (brief, not a duplicate of docs rules).
9. Commit initial scaffold.

## Todo List
- [x] pnpm workspace + root configs created, `pnpm install` succeeds
- [x] `tsconfig.base.json` extended by all 5 sub-projects, `pnpm -r typecheck` green on empty stubs
- [x] ESLint flat config runs clean on empty stubs
- [x] Vitest runs (0 tests, exit 0) in engine/react/collab-client
- [x] Playwright installed + config present in apps/web (smoke test: page loads, title present)
- [x] apps/collab-server wrangler dev server boots locally and responds 200 (port 8788)
- [x] LICENSE + LICENSE-THIRD-PARTY present
- [x] Initial commit made

## Success Criteria
- `pnpm install && pnpm -r typecheck && pnpm -r lint && pnpm -r test` all exit 0 from repo root.
- `pnpm --filter apps-web dev` serves a blank page at localhost.
- `pnpm --filter apps-collab-server dev` (wrangler dev) responds 200 locally.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Vite+Cloudflare Pages deploy friction discovered late | Low | Medium | Validate `wrangler pages dev` / static build output in this phase, not phase 16 |
| Source-only package exports break when deviva's Next/Turbopack resolves workspace deps | Low | Medium | Add a smoke import test in phase 15, not deferred to prod |

## Security Considerations
- None yet (no user data, no network surface). Establish `.env`/secrets gitignore pattern now so phase 13/14 secrets never get committed.

## Next Steps
- Blocks all phases 02–16.
- Rollback: delete repo — no external state created yet.
