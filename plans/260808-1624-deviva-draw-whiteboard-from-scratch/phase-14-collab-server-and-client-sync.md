# Phase 14 — Collab Server (Durable Objects) & Client Sync

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §10 (Live Collaboration — excalidraw.com flagship feature)
- Depends on: `phase-02-core-element-model-scene-store-history.md` (version/versionNonce/fractional-index foundations, built exactly for this phase), `phase-11-persistence-and-export.md` (initial room state = a serialized scene), `phase-13-share-links-e2e-encryption.md` (reuses R2/rate-limit/Worker patterns established there)

## Overview
- **Priority:** 🟢 (excalidraw.com flagship, locked into V1 scope per user decision) — largest and riskiest single phase, budget accordingly
- **Status:** pending
- Implement the live multiplayer room server on Cloudflare Durable Objects (one DO instance = one room, WebSocket fan-out), E2E-encrypted payloads (room key in URL fragment, server sees ciphertext only — extends phase 13's crypto model to a live channel), presence (named cursors, selections, follow-mode, idle detection), and conflict resolution (last-writer-wins per element via version/versionNonce, ordering via fractional indices).

## Key Insights
- **One Durable Object instance per room** is the natural fit: DOs provide a single-threaded, strongly-consistent actor per room ID, which is exactly the "one authoritative sequencer for this room's WebSocket connections" primitive needed — no separate pub/sub or coordination layer required (validates the user's architecture constraint rather than proposing an alternative).
- **The server is a relay, not a merge engine**: because encryption (phase 13's model, extended here) means the server cannot read element content, the DO's job is limited to (a) accepting encrypted messages from any connected client and broadcasting to all others in the room, (b) tracking room membership for presence, (c) persisting the latest encrypted snapshot to R2 periodically/on-empty so a room can be rehydrated after all clients disconnect. **Actual conflict resolution (LWW via version/versionNonce) happens client-side**, after decryption — this is the same trust boundary decision as phase 13 and must not be violated by, e.g., "just have the server peek at versions to resolve conflicts faster," which would require server-side decryption and break E2E.
- Client-side merge: each client maintains its local `Scene` (phase 02); on receiving a remote encrypted update, decrypt → for each remote element, compare `version`/`versionNonce` against the local copy — higher version wins outright; equal version with different `versionNonce` is resolved by a deterministic tiebreak (e.g., lexicographic comparison of `versionNonce`) so all clients converge to the same winner without a central arbiter. This is the well-established LWW-with-versionNonce pattern and must be implemented exactly (not approximated) since it's the entire correctness guarantee for concurrent edits.
- Fractional indices (already on every element since phase 02) resolve z-order conflicts the same way: concurrent reorders converge because fractional-index comparison is total-order-consistent regardless of which client's operation the server relays first.
- Presence (cursors/selections/follow/idle) is **not** subject to LWW merge — it's ephemeral, broadcast-only, never persisted to the room snapshot (a disconnected user's stale cursor must vanish, not merge into anything). Keep presence messages on a distinct message-type channel from element-delta messages so this distinction is structural, not a runtime check that can be gotten wrong.
- Reconnection: client tracks the last-applied remote version per room; on reconnect, requests a fresh encrypted snapshot from the DO (simpler and more robust than attempting a delta-replay protocol for a V1 — replay-based catch-up is a documented future optimization, not required for correctness since a full snapshot always converges).

## Requirements
- `apps/collab-server`: Durable Object class `RoomDO` — WebSocket upgrade handling, per-room connection registry, broadcast relay, periodic snapshot persistence to R2 (reusing phase 13's bucket or a dedicated `deviva-draw-rooms` bucket).
- Message protocol: `{type: 'element-delta' | 'presence' | 'snapshot-request' | 'snapshot'}`, encrypted payload for `element-delta`/`snapshot` (presence may be lighter-weight, still encrypted for consistency — no reason to weaken the E2E guarantee for cursor positions, which can reveal identity/behavior patterns).
- `packages/collab-client`: WebSocket connection management (connect/reconnect/backoff), encrypt-before-send/decrypt-on-receive (reusing phase 13's `encrypt-scene.ts`/`decrypt-scene.ts` primitives generalized to per-message rather than whole-scene), LWW merge logic, presence state management.
- Room URL scheme: `https://draw.deviva.app/room/{roomId}#key={base64Key}` (same fragment-key pattern as phase 13).
- Integration point into `packages/react`: a `useCollabSession(roomUrl)` hook that, when active, subscribes the local `Scene` to remote deltas and publishes local deltas — collab is opt-in (a scene works fully offline/solo without ever touching this package, consistent with phase 15's requirement that the lib package must not force collab on the deviva.app integration).

## Architecture
```
apps/collab-server/src/
├── room-durable-object.ts       RoomDO class: WS handling, broadcast, snapshot persistence
├── room-routes.ts                 WS upgrade route -> DO instance lookup by roomId
└── snapshot-persistence.ts         periodic + on-last-disconnect R2 snapshot write
packages/collab-client/src/
├── connection-manager.ts          WS connect/reconnect/backoff
├── message-codec.ts                encrypt/decrypt per-message (extends phase 13 primitives)
├── lww-merge.ts                    version/versionNonce/fractional-index conflict resolution
├── presence-state.ts                cursors/selections/follow/idle, ephemeral
└── use-collab-session.ts (re-exported via packages/react)  hook wiring Scene <-> connection
```

## Related Code Files
- Create: `apps/collab-server/src/room-durable-object.ts`, `room-routes.ts`, `snapshot-persistence.ts` (+ tests using `wrangler`'s local DO test harness / `vitest-pool-workers`)
- Modify: `apps/collab-server/wrangler.jsonc` (add `durable_objects` binding + migration block for `RoomDO`)
- Create: `packages/collab-client/src/*` listed above (+ `.test.ts` each — `lww-merge.ts` especially needs thorough property-based-style tests)
- Create: `packages/react/src/hooks/use-collab-session.ts` (thin wrapper exposing `packages/collab-client` to the React layer)
- Modify: `packages/engine/src/share-link/encrypt-scene.ts`/`decrypt-scene.ts` if generalizing to per-message encryption reveals shared logic worth extracting (assess during implementation, don't pre-guess the refactor)

## Implementation Steps
1. Scaffold `RoomDO`: WebSocket upgrade handler, in-memory connection set, broadcast-to-all-except-sender relay for `element-delta`/`presence` messages.
2. Add DO binding + migration to `wrangler.jsonc`; verify local `wrangler dev` supports DO testing (it does, via Miniflare under the hood).
3. Implement `snapshot-persistence.ts`: periodic (e.g. every 30s while active) and on-room-empty snapshot write to R2, keyed by `roomId`; `snapshot-request` message type triggers an on-demand snapshot broadcast to a reconnecting client.
4. Implement `packages/collab-client`'s `connection-manager.ts`: WebSocket lifecycle, exponential-backoff reconnect, `snapshot-request` on reconnect.
5. Implement `message-codec.ts`: per-message AES-GCM encrypt/decrypt reusing phase 13's key-derivation approach (same room key encrypts every message, distinct IV per message — critical detail, AES-GCM must never reuse an IV with the same key, unit tested explicitly).
6. Implement `lww-merge.ts`: the version/versionNonce/fractional-index resolution algorithm described in Key Insights — this is the phase's correctness-critical module, needs the most thorough test suite (concurrent-edit simulation: two "clients" apply conflicting local edits, exchange deltas, assert both converge to the identical final state).
7. Implement `presence-state.ts`: ephemeral cursor/selection broadcast, idle-detection timer, follow-mode (camera sync to a followed user's viewport).
8. Implement `use-collab-session.ts`: wires `connection-manager` + `lww-merge` to a local `Scene` instance — local mutations publish deltas, remote deltas apply through the merge function, presence renders on phase 03's interactive layer (remote cursors).
9. Integration test: two headless browser contexts (Playwright) join the same room, one draws a shape, assert it appears in the other within a bounded time; simulate a concurrent edit on the same element from both contexts, assert both converge identically.

## Todo List
- [ ] `RoomDO` implemented: WS relay, presence broadcast, snapshot persistence
- [ ] DO + R2 bindings configured in `wrangler.jsonc`, local dev verified
- [ ] `connection-manager.ts` implemented with reconnect/backoff
- [ ] Per-message encryption implemented, IV-reuse explicitly prevented and tested
- [ ] `lww-merge.ts` implemented with concurrent-edit convergence tests
- [ ] Presence (cursors/selection/follow/idle) implemented, confirmed ephemeral (never persisted)
- [ ] `useCollabSession` hook implemented, collab confirmed opt-in (solo mode unaffected when unused)
- [ ] Two-browser-context Playwright convergence test passing

## Success Criteria
- Two browser tabs in the same room: edits in one appear in the other within ~1s; presence cursors visible and correctly labeled.
- Concurrent edit to the same element from both tabs converges to an identical final state in both (deterministic, verified by test, not just "looked right manually").
- Disconnect/reconnect: client recovers via snapshot request, no duplicate or lost elements.
- Server-side: confirm via code review (not runtime behavior alone) that no code path decrypts payload content — the relay is structurally incapable of reading scene data.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LWW merge has a subtle non-convergence bug under 3+ way concurrent edits | Medium | High (silent data inconsistency between users) | Test suite explicitly includes 3-client concurrent-edit scenarios, not just 2; deterministic tiebreak rule (versionNonce lexicographic compare) is the same on every client by construction |
| AES-GCM IV reuse (catastrophic for that cipher mode — full key compromise) | Low if disciplined, High impact if it happens | Critical | Unit test explicitly asserts unique IV per encrypted message; code review checklist item; consider a monotonic counter component in IV derivation as defense-in-depth |
| Durable Object cold-start latency degrades perceived "live" feel for the first joiner | Medium | Low | Acceptable for V1 (DO cold starts are sub-100ms typically); not a blocking concern, note as a future perf-tuning item if user feedback flags it |
| Snapshot persistence race (DO evicted mid-write) loses recent edits | Low | Medium | Periodic snapshot (not only on-empty) bounds data loss to the snapshot interval; document this bound explicitly rather than assuming zero-loss |

## Security Considerations
- Full extension of phase 13's E2E model to a live channel — the server (DO + relay) must never decrypt. This is the phase's primary security property; verify via code review that no decryption key or `SubtleCrypto.decrypt` call exists anywhere in `apps/collab-server`.
- Room IDs non-guessable (same rationale as phase 13's blob IDs) — a room URL is the only way to discover it.
- Rate-limit WebSocket message frequency per connection (basic DoS mitigation against a malicious/buggy client flooding the relay) — reuse phase 13's rate-limiting pattern, now DO-backed (cheap to add per Key Insights' note in phase 13).

## Next Steps
- Blocks: nothing hard-blocks on this for phases 15/16 (lib extraction and marketing site can ship without live collab enabled, per `plan.md`'s milestone table — M3 is a parallel/later track relative to M4's phase 15/16, not a strict prerequisite), but the marketing site (phase 16) should surface collab as a feature once this phase is stable.
- Manual step required: confirm Cloudflare account supports Durable Objects on the current plan/zone (see `plan.md` unresolved question #2).
- Rollback: collab is opt-in at the hook level (`useCollabSession`) — disabling it is a UI-level feature flag, doesn't require reverting engine/persistence code.
