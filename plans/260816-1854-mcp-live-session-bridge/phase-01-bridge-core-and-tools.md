---
phase: 1
title: "Bridge Core + Tools"
status: done
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Bridge Core + Tools

## Overview

`LiveSessionBridge` + the three stdio-only tools: connect the active `SceneSession` scene to a
collab room as a headless peer, expose status/presence, and guard every lifecycle edge (double
connect, scene swap while connected, process exit).

## Requirements

- Functional: `connect_to_live_session {url, name?}` joins the room and returns
  `{roomId, status, peers}` (no key material); `disconnect_live_session` tears down and reports;
  `live_session_status` returns status + peer names/colors; all existing element/diagram tools
  propagate live once connected (no changes to those tools).
- Non-functional: `@deviva-draw/collab-client` added as a workspace dep of `packages/mcp`
  (published versions already aligned); zero engine/collab-client/collab-server diffs; tools
  excluded from the worker's `remoteTools`; key never surfaces anywhere observable.

## Architecture

- `src/live/live-session-bridge.ts`: singleton-per-process wrapper owning
  `CollabSession | null`. API: `connect(session: SceneSession, url: string, name?: string)`,
  `disconnect()`, `status()` (maps `CollabConnectionStatus` + `presence.list()`-equivalent).
  Validates via `parseRoomUrl` FIRST (its error strings are agent-safe — never include the
  fragment; verify + test). Wires `onStatusChange` into a small state field the status tool reads.
- `SceneSession` gains `lockScene(reason)` / `unlockScene()` (or a `liveBridge` back-reference —
  pick the smaller diff at implementation): `new_scene`/`open_scene` throw a `ToolError`
  ("disconnect the live session first") while connected. `save_scene`/exports stay allowed —
  they read the same live scene, which is a feature (agent can snapshot the shared board).
- Connect binds to the CURRENT `session.scene` (second-browser-peer semantics; LWW merge is the
  engine/collab-client's existing job). `joinSession(apiBaseUrl, url)` with
  `apiBaseUrl = env DEVIVA_MCP_COLLAB_URL ?? "https://collab-draw.deviva.app"`.
- Presence identity: `userName = input.name ?? "Claude (agent)"`, fixed color `#7048e8`
  (distinct from the web palette defaults).
- Process-exit hygiene: `disconnect()` on `process.on("exit")` + stdio transport close.
- Reference for wiring shape: `packages/react/src/hooks/use-collab-session.ts:103` (browser
  equivalent of exactly this construction).

## Related Code Files

- Create: `packages/mcp/src/live/live-session-bridge.ts` (+ colocated test)
- Create: `packages/mcp/src/tools/live-session-tools.ts` (+ colocated test)
- Modify: `packages/mcp/src/scene-session.ts` (connected-scene guard), `src/tools/index.ts`
  (register in `allTools`), `src/index.ts` (exports), `packages/mcp/package.json` (dep)
- NOT modified: `src/core.ts` (worker barrel must not import the bridge — `core-purity.test.ts`
  already enforces no new leaks), `apps/mcp-worker/**`, `packages/collab-client/**`

## Implementation Steps

1. Add `@deviva-draw/collab-client: workspace:*` to `packages/mcp`; confirm its import graph
   typechecks under the mcp tsconfig (node, DOM lib already present).
2. `live-session-bridge.ts` + unit tests with `createSocket` fake pairs (collab-client's own test
   pattern): connect happy path, double-connect refusal, bad URL reasons, disconnect idempotence,
   status/presence mapping.
3. Scene-swap guard in `SceneSession` + tests (`new_scene`/`open_scene` refused while connected).
4. `live-session-tools.ts` (3 tools, agent-facing errors per the ToolError house style) + tests;
   assert key-bearing URL never appears in any result/error payload (string-scan test).
5. Register in `allTools`; update `server.test.ts` tool list; `core-purity.test.ts` still green.
6. Fake-socket end-to-end: two `CollabSession`s (bridge + simulated browser peer) over a paired
   fake transport — agent `create_elements` arrives at peer scene; peer edit becomes visible to
   `search_scene_content`.

## Success Criteria

- [x] All new unit tests green; existing 66 stay green; typecheck/lint clean. (83 total in packages/mcp)
- [x] Fake-socket e2e proves bidirectional element flow through real CollabSession instances.
- [x] Key-leak string-scan test passes (no fragment content in any observable output).
- [x] Worker bundle guard + core-purity tests unchanged and green. (+ mcp-worker 18 tests green)

Code review (2026-08-16): no critical/security findings; fixed the 3 findings — transport-close
hook wired in `server.ts` (`server.server.onclose` → bridge disconnect, tested), disconnect now
settles an in-flight connect immediately, double-connect error says "connecting" when accurate.

## Risk Assessment

- **Node WebSocket global quirks vs browser** (event shapes, binary frames) → signal: connect
  test against fake sockets passes but wrangler-dev integration (Phase 2) fails on frames.
  Pre-decided response: adapt in `createSocket` factory inside the bridge (option already exists
  in `CollabSessionOptions`) — never patch collab-client.
- **LWW merge surprises when agent scene is non-empty at join** → signal: duplicated or
  resurrected elements in the fake-socket e2e. Response: document "connect early, then draw" and
  add a `connect_to_live_session` note recommending an empty scene; do NOT change merge code.
- **Timer/debounce keeps the stdio process from exiting** → signal: vitest hangs on teardown.
  Response: ensure `disconnect()` clears every timer (collab-client already does on disconnect;
  test asserts it).
