---
phase: 2
title: "Multi-page, Live Verification, Docs"
status: done
priority: P2
effort: "1d"
dependencies: [1]
---

# Phase 2: Multi-page, Live Verification, Docs

## Overview

Make the bridge faithful to real rooms (multi-page documents), prove it against the real relay and
a real browser, and document the feature.

## Requirements

- Functional: `CollabPagesAdapter` implemented over `SceneSession`'s page list so page-tagged
  deltas sync correctly and the page manifest merges (the browser side is multi-page by default);
  `live_session_status` reports the page list; agent tools keep operating on the active page.
- Non-functional: one integration test against a REAL `wrangler dev` collab-server (CI-runnable);
  manual live verification with an actual browser tab; docs within the existing ≤800-line cap.

## Architecture

- **PageStore extraction (validation decision):** move `PageStore` from
  `packages/react/src/pages/page-store.ts` into `@deviva-draw/collab-client` (it is verified
  framework-free — imports engine + collab-client only — and already type-imports
  `PagesManifest` from collab-client). React re-exports/imports from the new location;
  behavior byte-identical, all existing PageStore tests move with it.
  <!-- Updated: Validation Session 1 - naive ScenePage[] adapter rejected; reuse PageStore -->
- `src/live/`: `SceneSession` gains (or delegates to) a `PageStore`-backed page list when a live
  session connects, so the full `CollabPagesAdapter` contract (manifest LWW, tombstones,
  materialize-on-demand, empty-list rejection) is the SAME code the browser runs — mirror the
  wiring at `packages/react/src/hooks/use-collab-session.ts:68-105`, do not invent semantics.
  Remote page additions become visible in `describe_scene` (`pageCount`). Agent stays
  active-page-only (validated decision — no page targeting param).
- Integration test: spawn `wrangler dev` for `apps/collab-server` (same pattern as its own dev
  usage; port-pinned), connect bridge + a second plain `CollabSession` as the "browser", assert
  bidirectional sync through the real Durable Object relay. Skip-if-wrangler-unavailable guard so
  plain `pnpm test` stays fast; CI job runs it explicitly.
- Manual verification (session-end gate): real Chrome tab on draw.deviva.app in a live room +
  Claude Code driving the published/local server — screenshot the agent's diagram appearing live
  and the agent's presence entry.
- Docs: `docs/mcp.md` gains a "Draw on your open canvas (live sessions)" section (flow, security
  note about handing over the room key, single-page v1 caveats removed once this phase lands);
  README one-liner; CHANGELOG Unreleased entry.

## Related Code Files

- Move: `packages/react/src/pages/page-store.ts` (+ its tests) →
  `packages/collab-client/src/page-store.ts`; add collab-client index export
- Modify: `packages/react` imports of PageStore (repoint; keep a re-export for API stability)
- Create: `packages/mcp/src/live/pages-adapter.ts` (+ test),
  `packages/mcp/src/live/live-relay.integration.test.ts`
- Modify: `packages/mcp/src/live/live-session-bridge.ts` (pass `pages`),
  `packages/mcp/src/scene-session.ts` (page-list access point for the adapter),
  `src/tools/live-session-tools.ts` (status pages field), `docs/mcp.md`, `README.md`,
  `CHANGELOG.md`, `.github/workflows/ci.yml` (integration test step in the mcp-package job)
  <!-- Updated: Validation Session 1 - PageStore move + scene-session access point added -->
- NOT modified: `apps/collab-server/**` (relay untouched — only collab-CLIENT gains code)

## Implementation Steps

0. Move `PageStore` (+tests) into `@deviva-draw/collab-client`; repoint react imports (keep a
   re-export); full repo gate green before any mcp work builds on it.
1. Read the react `use-collab-session` pages wiring (`:68-105`); implement `pages-adapter.ts`
   over the moved `PageStore` + unit tests (remote page add/rename/delete reflected in
   `SceneSession`; manifest merge on cold join; empty-list rejection).
2. Wire into the bridge; extend fake-socket e2e to a multi-page round trip.
3. `wrangler dev` integration test + CI step (reuse the collab-server port convention; guard).
4. Manual live check with a real browser + screenshot evidence.
5. Docs + changelog; docs-sync test picks up the three new tool names automatically.

## Success Criteria

- [x] Multi-page room: agent sees correct `pageCount`; edits land on the active page; browser
      shows them live; browser page-rename visible to the agent. (fake-relay e2e + live check)
- [x] Integration test green against the real relay locally (CI step added; runs on next push).
- [x] Manual browser verification done with screenshot evidence in the plan dir
      (`live-verification-canvas.png`, `live-verification-presence.png` — real Chrome on
      draw.deviva.app, bridge over the production relay).
- [x] Docs updated; docs-sync + core-purity + bundle-guard all green; collab-server untouched.

## Implementation note (2026-08-16)

- The canonical pages adapter was extracted to `packages/collab-client/src/page-store-adapter.ts`
  (`createPageStoreCollabAdapter`) instead of a copy in `packages/mcp/src/live/pages-adapter.ts` —
  react and the bridge now share ONE implementation, eliminating the contract-drift risk this
  phase's Risk Assessment flagged. `SceneSession` is PageStore-backed outright (no attach/detach
  state machine).
- Live verification exposed a fresh-fresh UX gap: two v1 manifests union side-by-side, so the
  agent drew on its own union'd page, not the one the user watches. Fixed WITHIN the validated
  "no merge-code changes" constraint: post-join page adoption in the bridge (ordinary local
  PageStore ops — hop onto the room's first page and remove the agent's still-empty original;
  a pre-drawn agent scene keeps the documented both-boards union). Covered by two new e2e tests
  and re-verified live against production.

## Risk Assessment

- **Pages adapter contract drift** (react's adapter does more than the type suggests) → signal:
  manifest merge test diverges from browser behavior. Response: copy the react wiring semantics
  verbatim; if ambiguity remains, scope v1 to read-only page awareness (agent never mutates the
  page list) and note it.
- **wrangler dev in CI is slow/flaky** → signal: integration step >2min or intermittent. Response:
  keep it in the mcp-package job behind a retry-once; never gate deploys on it alone.
