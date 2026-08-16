---
title: "MCP Live-Session Bridge"
description: "connect_to_live_session: the MCP server joins the user's open E2E-encrypted collab room as a headless peer, so agent edits appear live on the canvas the user is looking at"
status: done
priority: P1
effort: "2-3d"
tags: [mcp, collab, ai, live]
created: 2026-08-16
blockedBy: []
blocks: []
---

# MCP Live-Session Bridge

## Overview

Close the one gap every competitor bridge fails at (research:
`plans/reports/research-260816-1854-live-canvas-mcp-competitors.md`): let the agent draw on the
canvas the user **currently has open in the browser** — with no browser extension, no desktop app,
no in-app plugin, and no accounts. Mechanism: the stdio MCP server joins the user's live collab
room as an ordinary headless peer via the already-published `@deviva-draw/collab-client`.

User flow:
1. User opens their board at draw.deviva.app → starts a live session → copies the room link
   (`https://draw.deviva.app/room/{id}#key=…` — E2E key rides the fragment, server never sees it).
2. User tells the agent: "connect to <link>".
3. Agent calls `connect_to_live_session {url}` → every subsequent `create_elements` /
   `create_diagram` / `update_elements` / `delete_elements` propagates to the user's open tab in
   real time (≤~100ms outbound debounce), the user's own edits flow back into the agent's scene,
   and the agent appears in the presence rail as a named collaborator.

## Why this wins (from the competitor research)

| Pattern | Reaches the user's real canvas? | Needs extra software? |
|---|---|---|
| Figma official (localhost desktop MCP) | yes | desktop app |
| Figma 3rd-party (plugin + WS relay) | yes | plugin + relay, fragile |
| excalidraw-mcp (bundled canvas page) | **no** — spun-up clone | local server |
| tldraw MCP App (SEP-1865 widget) | **no** — chat-embedded surface | none |
| Browser-extension bridges | DOM only, no scene model | extension |
| **Deviva (this plan)** | **yes — semantic scene model** | **none** |

## Verified feasibility (checked 2026-08-16, this session)

- `@deviva-draw/collab-client` source has ZERO browser-only APIs: transport is the `WebSocket`
  global, crypto is `crypto.subtle` — both Node ≥22 globals. Sole dependency: the engine.
- Join contract (public exports): `new CollabSession({ scene, pages?, userName, userColor })` then
  `await joinSession(apiBaseUrl, roomUrl)`; `disconnect()`; `onStatusChange` callback;
  `parseRoomUrl` validates the URL + fragment key and never throws
  (`packages/collab-client/src/collab-session.ts:128`, `room-url.ts:33`).
- The session binds to a live `Scene` via subscription — `SceneSession.scene` mutations from
  existing MCP tools flush automatically (80ms debounce, LWW versioning already stamped correctly
  because all tools mutate through `Scene.addElement/updateElement`).
- Browser reference wiring to mirror: `packages/react/src/hooks/use-collab-session.ts:103`.
- Relay: `apps/collab-server` (deployed, `collab-draw.deviva.app`) — zero changes expected.

## Architecture

```
user's browser tab ──ws──► collab-server (RoomDO, ciphertext only) ◄──ws── MCP stdio server
   (draw.deviva.app)                                                  LiveSessionBridge
                                                                        └─ CollabSession({scene: SceneSession.scene})
```

- **`LiveSessionBridge`** (`packages/mcp/src/live/`): owns at most ONE `CollabSession`; wires it to
  the active `SceneSession` scene; tracks status; tears down on disconnect tool call and process
  exit. stdio-transport-only (Workers can't hold WebSockets statelessly — remote endpoint
  explicitly excludes these tools, descriptions point at `npx @deviva-draw/mcp`).
- **Tools** (`src/tools/live-session-tools.ts`): `connect_to_live_session {url, name?}`,
  `disconnect_live_session {}`, `live_session_status {}` (status + peer list from
  `CollabSession.presence`). Registered in `allTools` for stdio; NOT in the worker's remote set.
- **Scene binding rule (v1, KISS):** connecting binds the room to the CURRENT session scene —
  same semantics as a second browser peer joining (LWW merge; two-fresh-peers union already
  handled by collab-client). `new_scene`/`open_scene` while connected → refused with a clear
  error ("disconnect first") so the bound scene can't be swapped out from under the room.
- **Multi-page:** v1 = single active page (no `pages` adapter; legacy un-tagged traffic path).
  Documented limitation; page-tagged deltas from a multi-page browser peer land per the
  collab-client legacy contract. Full `CollabPagesAdapter` arrives in Phase 2, backed by the
  browser's own `PageStore` moved into `@deviva-draw/collab-client` (Validation Session 1).
- **Presence:** agent joins as `name ?? "Claude (agent)"` with a fixed accent color, so the user
  SEES the agent in the presence rail. No cursor simulation in v1.

## Security

- The room URL fragment carries the E2E key. Contract: never logged, never persisted, never
  echoed back in any tool result or error message (errors reference the room id at most). Held
  only in `CollabSession`'s in-memory `CryptoKey`.
- `apiBaseUrl` defaults to `https://collab-draw.deviva.app`; overridable via
  `DEVIVA_MCP_COLLAB_URL` for self-hosters. URL validated by `parseRoomUrl` before any connect.
- Zero-knowledge stance unchanged: the relay still sees ciphertext only; the agent is just
  another E2E peer whose key the user handed over by pasting the link.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Bridge Core + Tools](./phase-01-bridge-core-and-tools.md) | Done |
| 2 | [Phase 2: Multi-page, Live Verification, Docs](./phase-02-pages-verification-docs.md) | Done |

## Related plans

- `260816-1114-mcp-server` (done) — this plan extends the shipped `@deviva-draw/mcp`; no blockers.

## Success Criteria

- [x] User opens a live room in the browser, pastes the link to Claude Code; agent's
      `create_diagram` appears on the user's open canvas within ~1s, user's edits are visible to
      the agent's next `describe_scene`/`search_scene_content`. (verified live on production —
      screenshots in this dir; required the post-join page-adoption fix, see phase-02 note)
- [x] Agent shows up (and disappears) in the browser's presence rail with its name.
      (live-verified: "1 online — Claude (agent)" → "0 online" after disconnect)
- [x] Disconnect (tool or process exit) leaves the room clean; reconnect works.
      (+ transport-close hook from Phase 1 review)
- [x] Room key never appears in logs, tool results, error messages, or saved files.
      (string-scan tests; static error messages; two review passes confirmed)
- [x] collab-server untouched; remote worker tool set unchanged (bridge is stdio-only).
- [x] All existing 66 mcp tests stay green (now 88); new unit tests use fake socket pairs; one
      integration test runs against a real `wrangler dev` collab-server (green locally, in CI
      behind `DEVIVA_MCP_INTEGRATION=1`).

## Open questions

None — both prior open questions resolved in Validation Session 1 (below).

## Validation Log

### Session 1 — 2026-08-16

### Verification Results
- Claims checked: 8 (Light tier: Fact Checker, 2 phases)
- Verified: 7 | Failed: 1 | Unverified: 0
- Tier: Light
- Verified highlights: `CollabSession` options + `joinSession` (`collab-session.ts:37,128`);
  `parseRoomUrl` never throws and its error strings never echo the key fragment
  (`room-url.ts:33-43`, all messages static); `createSocket` override exists (options:41);
  collab-client zero browser APIs / engine-only dep; react wiring at
  `use-collab-session.ts:103`; `SceneSession.pages` is private (adapter needs an access point).
- Failure (resolved via interview): Phase 2 originally said "adapter over `SceneSession`'s
  `ScenePage[]`" — the real `CollabPagesAdapter` contract (`pages-adapter.ts:27`) needs manifest
  LWW state + tombstones, which live in `PageStore` (`packages/react/src/pages/page-store.ts`,
  verified fully framework-free: imports engine + collab-client only, zero react references).

### Decisions (interview, 4 questions — all recommended options accepted)
1. **Join semantics:** bind the CURRENT session scene (second-browser-peer semantics, existing LWW
   merge); tool description advises connecting early/empty. No merge-code changes.
2. **Pages implementation (Phase 2):** MOVE `PageStore` from `packages/react/src/pages/` into
   `@deviva-draw/collab-client` (it already imports `PagesManifest` from there); react re-imports
   it. One canonical implementation, mechanical react-side change.
3. **Page targeting v1:** active page only; no `pageId` connect param.
4. **Presence:** rail entry only ("Claude (agent)", fixed color); no simulated cursor.

### Whole-Plan Consistency Sweep
- Re-read plan.md + both phase files after propagation.
- Phase-02 rewritten: PageStore extraction step added; Related Code Files now include
  `packages/collab-client` (gains page-store) and `packages/react` (import repoint); the
  "collab-client untouched" phrasing scoped to Phase 1 only (Phase 2 touches it by decision).
- Success criterion "collab-server untouched" unchanged (still true; only collab-CLIENT moves code).
- No remaining references to pageId params, simulated cursors, or the naive ScenePage[] adapter.
- Unresolved contradictions: none.
