---
title: "MCP live-session bridge: agent draws on the user's open canvas"
date: 2026-08-16
summary: "Shipped connect_to_live_session — the stdio MCP server joins the user's E2E collab room as a headless peer; live verification caught a fresh-fresh page-union UX bug that unit tests could not"
---

# MCP live-session bridge: agent draws on the user's open canvas

## What happened

Implemented plans/260816-1854-mcp-live-session-bridge end to end (both phases) — the gap every
competitor bridge fails at: the agent drawing on the canvas the user currently has open, with no
extension/plugin/account. Mechanism: `@deviva-draw/mcp`'s stdio server joins the live room as an
ordinary headless `CollabSession` peer.

Phase 1: `LiveSessionBridge` (packages/mcp/src/live/) + 3 stdio-only tools
(`connect_to_live_session`, `disconnect_live_session`, `live_session_status`), scene lock against
`new_scene`/`open_scene` while connected, key-leak-proof error contract (static messages, room id
at most; string-scan tests). Review caught a real gap: `process.on("exit")` alone is useless once
a live WebSocket + timers keep the event loop alive — wired `server.server.onclose` (stdin EOF →
bridge disconnect) instead.

Phase 2: moved `PageStore` react → collab-client (0.4.0→0.5.0) and extracted the react hook's
inline pages adapter as canonical `createPageStoreCollabAdapter` — browser and bridge now run the
same multi-page sync code, killing the contract-drift risk. `SceneSession` became PageStore-backed
outright (simpler than an attach/detach state machine). Integration test spawns real `wrangler
dev` (port 8799, kill-group + wait-for-port-free teardown); CI pack-smoke now installs the
collab-client tarball — without that, published mcp would import a `PageStore` that npm's
collab-client 0.4.0 doesn't have. mcp bumped to 0.7.0 so `pnpm publish -r` actually ships it.

## The lesson: live verification earns its keep

All 84 unit/e2e tests were green, and the real-browser check against production still failed the
headline flow: with two fresh single-page boards, the pages-manifest equal-version union put the
agent's diagram on a side-by-side ghost page while the user stared at their own empty page
("1/2" in the page indicator was the tell). Fixed within the validated "no merge-code changes"
constraint: post-join adoption in the bridge — if the agent's single original page is still empty
once room pages arrive, hop onto the room's first page and remove the ghost (ordinary local
PageStore ops that propagate like any peer's). Re-verified live: diagram lands on the user's
visible canvas, "Claude (agent)" in the presence list, "0 online" after disconnect. Screenshots
in the plan dir.

## Decisions

- One canonical pages adapter in collab-client (DRY beat the plan's file layout, which wanted a
  copy in mcp; the plan's own risk section warned about exactly that drift).
- Adoption only ever discards the agent's OWN pre-join empty page (`elementsUnsorted()` includes
  soft-deleted — biased against data loss). Pre-drawn agent scene keeps the documented
  both-boards union.

## Next steps

- Commit pending user go-ahead; suggest release tag after (mcp 0.7.0 + collab-client 0.5.0).
- Watch the first CI run of the new `DEVIVA_MCP_INTEGRATION=1` step.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
